import { CrawlerClient } from "./oshimateru";

const benchmark = async () => {
  const crawlerClient = new CrawlerClient({
    retryDelay: 1000,
    proxyList: [],
  });

  console.time("total time");

  await crawlerClient.main();

  console.timeEnd("total time");
};

benchmark();

// total time: 54:26.794 (m:ss.mmm)
// total time: 51:22.250 (m:ss.mmm)
