import got, {
  Agents,
  OptionsOfBufferResponseBody,
  OptionsOfJSONResponseBody,
} from "got";
import cheerio from "cheerio";
import { HttpsProxyAgent } from "hpagent";
import { sleep } from "./utils";
import fs from "fs";
import { ROOT_CLUSTER_KEYS, USER_AGENT } from "./constants";
import { Maker, Cluster, Proxy } from "./interfaces";

type ResponseType = "buffer" | "json";

type RequestOptions<T extends ResponseType> = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  responseType: T;
  json?: Record<string, any>;
  body?: { [name: string]: string };
  header?: { [name: string]: string };
  successStatusCodes?: number[];
  retryDelay?: number;
};

interface CrawlerClientConstructorOptions {
  retryDelay: number;
  proxyList: Proxy[];
}

export class CrawlerClient {
  private _retryDelay: number;
  private _proxyList: Proxy[];
  private _currentProxy?: Proxy;
  private _proxyAgent?: Agents;
  private _useProxy: boolean;
  private _runningCount: number;
  private _runningLimit: number;

  private _makerResult: Maker[];
  private _clusterResult: Cluster[];
  private _postData: any[];

  constructor(options: CrawlerClientConstructorOptions) {
    this._makerResult = [];
    this._clusterResult = [];
    this._postData = [];

    this._retryDelay = options.retryDelay;
    this._runningCount = 0;
    this._runningLimit = 100;

    this._proxyList = options.proxyList;
    this._currentProxy =
      options.proxyList.length > 0
        ? options.proxyList[
            Math.floor(Math.random() * options.proxyList.length)
          ]
        : void 0;
    this._useProxy =
      this._currentProxy &&
      this._currentProxy.host !== "" &&
      !isNaN(this._currentProxy.port)
        ? true
        : false;

    this._setupProxyAgent();
  }

  private _setupProxyAgent(): void {
    if (!this._useProxy && !this._currentProxy) {
      this._proxyAgent = void 0;
      return;
    }
    const basichAuth =
      this._currentProxy?.user !== "" && this._currentProxy?.password !== "";
    this._proxyAgent = {
      https: new HttpsProxyAgent({
        proxy: `http://${
          basichAuth
            ? this._currentProxy?.user + ":" + this._currentProxy?.password
            : ""
        }@${this._currentProxy?.host}:${this._currentProxy?.port}`,
      }),
    };
  }

  private async _fetchPostData(markerKey: string): Promise<void> {
    const res = await this._request(
      `https://www.oshimaland.co.jp/d/${markerKey}.json`,
      {
        responseType: "json",
        method: "GET",
        successStatusCodes: [200],
      }
    );

    if (res) {
      this._postData.push(res);
      console.log(`合計${this._postData.length}件の投稿データを取得しました`);
      return;
    }
  }

  private async _findPostData(): Promise<void> {
    const promises: Promise<void>[] = [];
    let index = 0;

    for (let i = 0; i < this._makerResult.length; i++) {
      if (i < this._runningLimit) {
        const task = async (): Promise<void> => {
          if (
            index < this._makerResult.length &&
            this._runningCount < this._runningLimit
          ) {
            this._runningCount++;
            console.log(`Currently Running: ${this._runningCount}`);
            await this._fetchPostData(this._makerResult[index++].key);
            this._runningCount--;
            return task();
          }
          return;
        };
        promises.push(task());
      }
    }
    await Promise.all(promises);
  }

  /*
  private async _findMaker(): Promise<void> {
    let index = 0;
    while (index < this.clusterResult.length || 0 < this._runningCount) {
      const tasks: Array<() => Promise<void>> = [];
      for (let i = 0; i < this._runningLimit; i++) {
        const task = async (): Promise<void> => {
          if (
            index < this.clusterResult.length &&
            this._runningCount < this._runningLimit
          ) {
            this._runningCount++;
            console.log(`Currently Running: ${this._runningCount}`);
            await this.fetchCluster([this.clusterResult[index++].cluster_key]);
            this._runningCount--;
            return;
          }
        };
        tasks.push(task);
      }
      tasks.forEach((task) => task());
      await sleep(1000);
    }
  }
  */

  private async _findMaker(): Promise<void> {
    let index = 0;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < this._runningLimit; i++) {
      const task = async (): Promise<void> => {
        if (
          index < this._clusterResult.length &&
          this._runningCount < this._runningLimit
        ) {
          this._runningCount++;
          console.log(`Currently Running: ${this._runningCount}`);
          await this._fetchCluster([this._clusterResult[index++].cluster_key]);
          this._runningCount--;
          return task();
        }
      };
      promises.push(task());
    }
    await Promise.all(promises);
  }

  // clusterkeyの配列を受け取ってcluster(tree)からmarker(leaf)を再帰処理で探索する
  private async _fetchCluster(clusterKeys: readonly string[]): Promise<void> {
    // marker(leaf) cluster(node)が含まれる
    const res = await this._request("https://api.oshimaland.co.jp/map", {
      method: "POST",
      responseType: "json",
      json: clusterKeys,
      successStatusCodes: [200],
    });

    try {
      const { markers, clusters } = res as any;

      // marker(leaf)取得
      if (markers && Object.keys(markers).length) {
        for (const key in markers) {
          this._makerResult.push(...markers[key]);
        }
      }

      // cluster(node)取得
      if (clusters && Object.keys(clusters).length) {
        for (const key in clusters) {
          clusters[key].forEach((cluster: Cluster) => {
            this._clusterResult.push(cluster);
          });
        }
      }
      console.log(
        `Total: Cluster: ${this._clusterResult.length}　Maker: ${this._makerResult.length}`
      );
      return;
    } catch (e) {
      console.error(e);
    }
    await sleep(this._retryDelay);
    return this._fetchCluster(clusterKeys);
  }

  private _roateProxy(): void {
    this._currentProxy =
      this._proxyList[Math.floor(Math.random() * this._proxyList.length)];
  }

  private async _request<T extends ResponseType>(
    url: string,
    {
      responseType,
      successStatusCodes = [200],
      header,
      method,
      body,
      json,
      retryDelay = 1000,
    }: RequestOptions<T>
  ): Promise<
    T extends "json"
      ? Record<string, any> | undefined
      : cheerio.Root | undefined
  > {
    const options = {
      responseType,
      successStatusCodes,
      header,
      method,
      body,
      json,
      retryDelay,
    };

    const requestOptions:
      | OptionsOfJSONResponseBody
      | OptionsOfBufferResponseBody = {
      timeout: 180000,
      method,
      throwHttpErrors: false,
      responseType: responseType,
      retry: 0,
      hooks: {
        beforeRedirect: [
          (options) => {
            options.method = "GET";
            options.headers = {
              "user-agent": USER_AGENT,
            };
          },
        ],
      },
      headers: {
        "user-agent": USER_AGENT,
        ...header,
      },
    };

    if (this._useProxy) {
      this._roateProxy();
    }

    if (responseType === "json" && requestOptions.headers) {
      if (json) {
        requestOptions.json = json;
      }
      requestOptions.headers["Content-Type"] = "application/json";
    }

    if (this._useProxy) {
      requestOptions.agent = this._proxyAgent;
    }

    try {
      const res = await got(url, requestOptions);

      if (
        res.statusCode &&
        successStatusCodes.find((statusCode) => statusCode == res.statusCode)
      ) {
        const responseBody =
          responseType === "buffer"
            ? cheerio.load(res.body as string)
            : res.body;
        return responseBody as T extends "json"
          ? Record<string, any> | undefined
          : cheerio.Root | undefined;
      } else if (res.statusCode == 429 || res.statusCode == 403) {
        // アクセス制限の場合プロキシをローテーション
        if (this._useProxy) this._roateProxy();
      }
    } catch (err) {
      console.error(err);
    }
    await sleep(this._retryDelay);
    return this._request(url, options);
  }

  async main(): Promise<void> {
    await this._fetchCluster(ROOT_CLUSTER_KEYS);
    await this._findMaker();
    await this._findPostData();
    fs.writeFileSync("result.json", JSON.stringify(this._postData, null, 2));
  }
}
