export enum RequestName {
  collect = "collect",
  debugCollect = "debugCollect",
}

/** Metadata on how an incoming Request matched a handling rule. */
export interface RequestMeta {
  url: URL;
  headers: Headers;
}

export interface DebugRequestMeta {
  debug: boolean;
}

/** The metadata available from GA4 MP request URLs. */
export interface CollectRequestMeta extends RequestMeta, DebugRequestMeta {
  name: RequestName;
  measurement_id: string | null;
  api_secret: string | null;
}

export interface UnknownRequestMeta extends RequestMeta {
  name: null;
}

export type MaybeCollectRequestMeta = CollectRequestMeta | UnknownRequestMeta;

/** The metadata available from GA4 MP request URLs for known, allowed Data Stream. */
export interface ApprovedCollectRequestMeta extends CollectRequestMeta {
  measurement_id: string;
  api_secret: string;
  /** The GA4 MP API URL to send the payload to. */
  endpoint: string;
}
