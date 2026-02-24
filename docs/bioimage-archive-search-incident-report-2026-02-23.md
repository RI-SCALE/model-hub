# BioImage Archive Search Incident Report (for Maintainers)

Date: 2026-02-23  
Prepared by: RI-SCALE Model Hub team

## 1) Summary
We observed repeated search failures from the BioImage Archive search endpoints during an end-user query flow. The same session later ended with a model/proxy timeout. 

Current status at the time of this report: direct re-probing of the same endpoint/query patterns returned HTTP 200 consistently, which suggests an intermittent upstream issue rather than a permanent outage.

## 2) User-visible impact
- User request: "find me 5 mouse tumor datasets"
- Result during failing run: tool calls repeatedly failed, then final assistant message reported timeout.
- End-user message shown: "Error from proxy: Request timed out."

## 3) Evidence from failing runtime session (captured logs)
The following tool calls failed with server-side 500 errors:

- `search_datasets` with query `(mouse OR mice OR murine) AND (tumor OR tumour OR cancer)`  
  Error text: `Server error '500' for url 'https://beta.bioimagearchive.org/search/search/fts?query=(mouse%20OR%20mice%20OR%20murine)%20AND%20(tumor%20OR%20tumour%20OR%20cancer)'`

- `search_datasets` with query `mouse OR mice OR murine OR tumor OR tumour OR cancer`  
  Error text: `Server error '500' for url 'https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20mice%20OR%20murine%20OR%20tumor%20OR%20tumour%20OR%20cancer'`

- `search_datasets` with query `mouse OR tumor`  
  Error text: `Server error '500' for url 'https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20tumor'`

- `search_images` with query `mouse AND tumor`  
  Error text: `Server error '500' for url 'https://beta.bioimagearchive.org/search/search/fts/image?query=mouse%20AND%20tumor'`

Additional session outcome:
- Proxy/model loop eventually returned: `{"error": "Request timed out."}`

## 4) Independent direct endpoint probe (performed after incident)
To verify endpoint health, we queried the same URL patterns directly from the client environment (outside browser CORS path).

Probe window (UTC): 2026-02-23T12:52:32Z to 2026-02-23T12:52:41Z  
Total requests: 15  
HTTP status distribution: 15x 200

### Probe results (timestamped)

| timestamp_utc | attempt | endpoint | query_label | http_code |
|---|---:|---|---|---:|
| 2026-02-23T12:52:32Z | 1 | fts | q_complex | 200 |
| 2026-02-23T12:52:33Z | 1 | fts | q_or_long | 200 |
| 2026-02-23T12:52:34Z | 1 | fts | q_short | 200 |
| 2026-02-23T12:52:34Z | 1 | fts/image | q_image_and | 200 |
| 2026-02-23T12:52:35Z | 1 | fts/image | q_image_or | 200 |
| 2026-02-23T12:52:36Z | 2 | fts | q_complex | 200 |
| 2026-02-23T12:52:36Z | 2 | fts | q_or_long | 200 |
| 2026-02-23T12:52:37Z | 2 | fts | q_short | 200 |
| 2026-02-23T12:52:38Z | 2 | fts/image | q_image_and | 200 |
| 2026-02-23T12:52:38Z | 2 | fts/image | q_image_or | 200 |
| 2026-02-23T12:52:39Z | 3 | fts | q_complex | 200 |
| 2026-02-23T12:52:39Z | 3 | fts | q_or_long | 200 |
| 2026-02-23T12:52:40Z | 3 | fts | q_short | 200 |
| 2026-02-23T12:52:41Z | 3 | fts/image | q_image_and | 200 |
| 2026-02-23T12:52:41Z | 3 | fts/image | q_image_or | 200 |

One sampled successful response during probe:
- URL: `https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20tumor`
- Status: `HTTP/2 200`
- Body prefix: `{"hits":{"total":{"value":0,"relation":"eq"},...}` (valid JSON payload)

## 5) Assessment
Based on this evidence:
- The failure is real (multiple 500 responses during user session across both dataset and image search endpoints).
- The issue appears intermittent/transient (subsequent direct probes returned stable 200 responses).
- This pattern is consistent with temporary upstream backend/index/gateway instability rather than a persistent schema/query-format issue.

## 6) Suggested maintainer checks (respectfully suggested)
- Review server logs for the failing timestamps around the user session (especially 5xx bursts on `/search/search/fts` and `/search/search/fts/image`).
- Check backend search cluster health, queue saturation, and timeouts.
- Check gateway/load balancer/WAF behavior for transient 5xx responses.
- Confirm whether any rolling deploy/reindex/maintenance occurred during the failure window.

## 7) Repro URLs used
- `https://beta.bioimagearchive.org/search/search/fts?query=(mouse%20OR%20mice%20OR%20murine)%20AND%20(tumor%20OR%20tumour%20OR%20cancer)`
- `https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20mice%20OR%20murine%20OR%20tumor%20OR%20tumour%20OR%20cancer`
- `https://beta.bioimagearchive.org/search/search/fts?query=mouse%20OR%20tumor`
- `https://beta.bioimagearchive.org/search/search/fts/image?query=mouse%20AND%20tumor`
- `https://beta.bioimagearchive.org/search/search/fts/image?query=mouse%20OR%20tumor`

---
We appreciate the BioImage Archive team’s support and understand intermittent issues can happen in production systems. We hope this report is useful and are happy to provide any additional logs or run further directed probes if helpful.
