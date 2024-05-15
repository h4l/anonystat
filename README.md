# Anonystat

Anonystat is a privacy-enhancing proxy that isolates your users from Google
Analytics.

- Users send events to Anonystat, which anonymises and forwards them to Google
  Analytics
- Google Analytics does not see user IP addresses
- Anonystat can create anonymous user IDs without storing cookies in users'
  browsers
- Anonystat supports the [GA4 Measurement Protocol] (_not_ [gtag.js])
- Self-host for free using [Deno Deploy]

[GA4 Measurement Protocol]: https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events
[gtag.js]: https://developers.google.com/analytics/devguides/collection/gtagjs
[Deno Deploy]: https://deno.com/deploy

## Status

Anonystat is new and probably has some rough edges!

## Deploy

1. Clone this git repository
2. Follow [Deno Deploy Quick Start] to install the `deno` and `deployctl` CLI
   tools
3. Configure the Google Analytics Data Stream to send events to

   - Find API secret and Measurement ID values of the Google Analytics Data
     Stream you will send events to:

     - Open your [Google Analytics dashboard]
     - Open the Admin settings and navigate to **Data streams**
     - Open the Data stream you will send events to
     - Copy the Measurement ID (`G-XXXXXXXXXX`, **NOT the Stream ID**)
     - Open the "Measurement Protocol API secrets" link on this Data stream's
       page
     - Create an API secret and copy the value

4. Go to the [Deno Deploy dashboard] and create a project

   In your project's settings page, set these environment variables after
   editing the values to match your API secret and Measurement ID values:

   ```sh
   # These are the measurement_id and api_secret URL query params you use to
   # send events to your Anonytat deployment. They can be any values you like.
   ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID=example-id
   ANONYSTAT_DATA_STREAM_IN_API_SECRET=example-secret
   # These are the Google Analytics measurement_id and api_secret values
   # Anonystat will forward events to if they match the IN values above.
   # Find these values from the Google Analytics admin console.
   ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID=G-XXXXXXXXXX
   ANONYSTAT_DATA_STREAM_OUT_API_SECRET=Ab12Ab12Ab12Ab12Ab12Ab
   ```

   > Make a note of your settings, as Deno Deploy doesn't show the values after
   > you save them.

5. Deploy!

   Create a deployment in your Deno Deploy project using deployctl. Run
   `deployctl deploy --project "example-project"` (substitute your project name
   after the `--project` option).

   You should see output like this:

   ```console
   $ deployctl deploy --project "example-project"
   ℹ Using config file '/workspaces/anonystat/deno.json'
   ✔ Deploying to project example-project.
   ✔ Entrypoint: /workspaces/anonystat/main.ts
   ℹ Uploading all files from the current dir (/workspaces/anonystat)
   ✔ Found 100 assets.
   ✔ Uploaded 6 new assets.
   ✔ Preview deployment complete.
   ℹ Some of the config used differ from the config found in '/workspaces/anonystat/deno.json'. Use --save-config to overwrite it.

   View at:
   - https://example-project-xxxxxxxxxxxx.deno.dev
   ```
6. Send a test event

Use `curl` to send test event to your deployment.

```console
$ curl -i --json @data/search-event.json "https://example-project-xxxxxxxxxxxx.deno.dev/mp/collect?api_secret=example-secret&measurement_id=example-project"
HTTP/2 204
...
```

- Substitute the values you configured for `api_secret` and `measurement_id`
  query parameters.
- This sends the example [data/search-event.json](data/search-event.json)
  payload. Use the [Event Builder] to construct events to test with.
- You should get 204 ("no content") response if it works
- The event should appear within a few seconds in the "Realtime overview"
  section of your [Google Analytics dashboard].

[Deno Deploy dashboard]: https://dash.deno.com/projects/
[Deno Deploy Quick Start]: https://docs.deno.com/deploy/manual
[Google Analytics dashboard]: https://analytics.google.com/
[Event Builder]: https://ga-dev-tools.google/ga4/event-builder/

## Features

- Generate anonymous `user_id` values for event payloads without browser cookies
  - Anonystat generates IDs by hashing:
    - User IP address, browser user agent and language headers
    - A secret that's re-generated after a fixed time interval (e.g. weekly or
      monthly)
    - An optional additional secret from the deployment configuration
- Scramble `user_id` values provided in event payloads to un-link browser IDs
  from analytics IDs
  - Generating a random `user_id` client-side and storing them in session
    storage is arguably more private than not storing an identifier and relying
    on IP hashing, as the ID stored in analytics data has absolutely no link to
    user data.
- Validate GA4 MP event payloads to catch errors
- Hide actual Google Analytics tag ID from public view
- No need for client-side to include a 3rd-party tracking script
  - For example, this
    [tutorial on using Google Analytics 4 in a Chrome Extension] shows how to
    send events just using `fetch()` calls.

[tutorial on using Google Analytics 4 in a Chrome
    Extension]: https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4

## Configuration

Anonystat is configured using environment variables. It also has a JSON config
format. See the [`data/config_*`](./data/) files for some examples.

```jsonc
{
  // Configs define one or more Google Analytics Data Stream that Anonystat will
  // forward events to. Each Data Stream is identified by a measurement_id, and
  // corresponding api_secret.
  //
  // "forward" and "data_stream" can be repeated multiple times by using an
  // array of objects — see data/config_multiple.json for an example.
  "forward": {
    "data_stream": {
      // The "in" values are used in the URL when sending events to Anonystat,
      // e.g. https://.../mp/collect?api_secret=xxx&measurement_id=yyy
      "in": {
        "measurement_id": "foo",
        "api_secret": "secret123"
      },
      // The "out" values are used by Anonystat when forwarding events to Google
      // Analytics for the corresponding "in" credentials
      "out": {
        "measurement_id": "G-ABCDE12345",
        "api_secret": "Ab12Ab12Ab12Ab12Ab12Ab"
      }
    },
    // "user_id" controls how user_id values are generated/anonymised when
    // Anonystat forwards events.
    "user_id": {
      // "lifetime" controls the repeating periods in which user_id values will
      // be stable. After each lifetime, Anonystat generates and stores a new
      // secret, and as a result generates/scrambled user_ids are different in
      // each lifetime period.
      "lifetime": {
        "count": 2,
        // Possible values are "hours", "days", "weeks", "months", "quarters",
        // "years"
        "unit": "months",
        // The reference point to start the period. Default is 1970-01-01 00:00
        "from": "2024-02-14T00:00:00Z"
      },
      // "scrambling_secret" is combined with the lifetime secret when hashing
      // values to generate/scramble user_id values. It's not essential, as the
      // randomly-generated lifetime secret makes user_ids unpredictable, but
      // this can be used to force user_id values to change, or just for good
      // measure.
      "scrambling_secret": "0000000",
      // How to treat existing user_id values in incoming event payloads.
      // Possible values are "replace", "keep" or "scramble".
      // - "replace" will overwrite an existing user_id value with a generated
      //   value, as if user_id was not provided.
      // - "scramble" (the default) will hash the provided user_id with the
      //   available secrets to create a deterministic, but unpredictable value.
      // - "keep" will leave the provided user_id as-is in the forwarded event
      //   payload.
      "existing": "keep"
    },
    // The URL Anonystat will forward events to.
    // Default is "https://www.google-analytics.com/mp/collect"
    "destination": "https://example.com/mp/collect",
    // If true, events can be sent to the /debug/mp/collect path, in addition to
    // the regular /mp/collect path for the the above measurement_id(s).
    // The debug path shows validation error details for invalid event payloads.
    "allow_debug": true
  },
  // Control the TCP socket Anonystat opens to listen for HTTP requests. This is
  // not needed when deploying to Deno Deploy.
  "listen": {
    // Default is 8000
    "port": 9000,
    // Default is localhost/loopback (use 0.0.0.0 to listen on all interfaces)
    "hostname": "1.2.3.4"
  }
}
```

Anonystat provides a config tool to validate and print environment variables for
a JSON config file.

```console
$ deno task config data/config_single.json
ANONYSTAT_USER_ID_LIFETIME=R/2024-02-14/P2M
ANONYSTAT_USER_ID_EXISTING=replace
ANONYSTAT_USER_ID_SCRAMBLING_SECRET=0000000
ANONYSTAT_ALLOW_DEBUG=true
ANONYSTAT_DESTINATION=https://example.com/mp/collect
ANONYSTAT_LISTEN_HOSTNAME=1.2.3.4
ANONYSTAT_LISTEN_PORT=9000
ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID=foo
ANONYSTAT_DATA_STREAM_IN_API_SECRET=secret123
ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID=G-ABCDE12345
ANONYSTAT_DATA_STREAM_OUT_API_SECRET=Ab12Ab12Ab12Ab12Ab12Ab
```

Use `--format env-json` to get a single environment variable, which is easier to
copy & paste for Deno Deploy:

```console
$ deno task config data/config_single.json --format env-json
ANONYSTAT_CONFIG_SOURCE=json
ANONYSTAT_CONFIG={"forward":{"data_stream":{"in":{"measurement_id":"foo","api_secret":"secret123"},"out":{"measurement_id":"G-ABCDE12345","api_secret":"Ab12Ab12Ab12Ab12Ab12Ab"}},"user_id":{"existing":"replace","lifetime":{"count":2,"unit":"months","from":"2024-02-14"},"scrambling_secret":"0000000"},"allow_debug":true,"destination":"https://example.com/mp/collect"},"listen":{"hostname":"1.2.3.4","port":9000}}
```

## Background

I created Anonystat because I maintain some browser extensions, and wanted a
privacy-preserving, anonymous way to send metrics to Google Analytics. There are
good alternatives to Google Analytics, but I wanted:

- A no-cost solution (my extensions are hobby projects that don't make money)
- The ability to track sessions without cookies, like [Goat Counter]
- Privacy for users — no direct exposure to Google Analytics, or others.

[Goat Counter]: https://github.com/arp242/goatcounter/blob/master/docs/rationale.md
