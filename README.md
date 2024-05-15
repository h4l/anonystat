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

## Background

I created Anonystat because I maintain some browser extensions, and wanted a
privacy-preserving, anonymous way to send metrics to Google Analytics. There are
good alternatives to Google Analytics, but I wanted:

- A no-cost solution (my extensions are hobby projects that don't make money)
- The ability to track sessions without cookies, like [Goat Counter]
- Privacy for users — no direct exposure to Google Analytics, or others.

[Goat Counter]: https://github.com/arp242/goatcounter/blob/master/docs/rationale.md
