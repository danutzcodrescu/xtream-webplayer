import type {
  XtreamCategory,
  XtreamStream,
  XtreamEpgEntry,
  XtreamAuthResponse,
} from "../lib/server/xtream.js";

export const categories: XtreamCategory[] = [
  { category_id: "news", category_name: "News", parent_id: 0 },
  { category_id: "sport", category_name: "Sport", parent_id: 0 },
];
export const channel: XtreamStream = {
  num: 1,
  name: "World News",
  stream_type: "live",
  stream_id: 7,
  stream_icon: "",
  epg_channel_id: "news",
  added: "",
  category_id: "news",
  direct_source: "",
  tv_archive: 1,
  tv_archive_duration: 7,
};
export const programme: XtreamEpgEntry = {
  id: "broadcast-1",
  epg_id: "1",
  title: "Daily Bulletin",
  description: "Today's headlines",
  lang: "en",
  start: "",
  end: "",
  channel_id: "news",
  start_timestamp: 100,
  stop_timestamp: 200,
};
export const authenticated: XtreamAuthResponse = {
  user_info: {
    username: "provider-user",
    password: "provider-password",
    auth: 1,
    status: "Active",
    exp_date: null,
    is_trial: "0",
    active_cons: "0",
    max_connections: "2",
    allowed_output_formats: ["m3u8"],
  },
  server_info: {
    url: "provider.test",
    port: "80",
    https_port: "443",
    server_protocol: "https",
    timezone: "UTC",
    timestamp_now: 150,
    time_now: "",
  },
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
