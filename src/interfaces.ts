// 物件データ
export interface Maker {
  key: string;
  cluster_key: string;
  latitude: number;
  longitude: number;
}

export interface Cluster {
  cluster_key: string;
  count: number;
  latitude: number;
  longitude: number;
  max_latitude: number;
  max_longitude: number;
  min_latitude: number;
  min_longitude: number;
}

export interface Proxy {
  host: string;
  port: number;
  user?: string;
  password?: string;
}
