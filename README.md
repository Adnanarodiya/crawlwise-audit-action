# crawlwise audit action

Audit your preview deployment on every pull request with [crawlwise](https://crawlwise.site). The action compares the run with the last audit of the same URL, **posts one comment with what changed**, and **fails the build** on a critical SEO regression, or when the score drops under `min-score`.

Every finding cites the check it came from. A check that did not run on the baseline is reported as new, never as a regression: a methodology change is not a defect.

## Usage

```yaml
name: SEO
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: Adnanarodiya/crawlwise-audit-action@v1
        with:
          url: https://preview.your-site.com
          api-key: ${{ secrets.CRAWLWISE_API_KEY }}
          min-score: 80
```

Create the API key at [crawlwise.site/account/api](https://crawlwise.site/account/api) (Pro plan and above) and save it as the repository secret `CRAWLWISE_API_KEY`.

## Inputs

| Input | Required | Default | Meaning |
|---|---|---|---|
| `url` | yes | | The URL to audit, usually the preview deployment |
| `api-key` | yes | | A crawlwise API key |
| `fail-on` | no | `critical` | `critical` (indexing or AI-crawler access regressed), `warning` (any regression), or `never` |
| `min-score` | no | | Also fail when the Crawlwise checklist score is below this (0-100) |
| `comment` | no | `true` | Post or update one pull-request comment with the diff |
| `baseline` | no | latest audit of the URL | An explicit audit id to compare against |
| `github-token` | no | `github.token` | Used to write the comment |
| `endpoint` | no | `https://crawlwise.site` | API origin |

## Outputs

`audit-id`, `severity` (`none`, `info`, `warning`, `critical`), `regressions`, `score`.

## Not on GitHub?

The [crawlwise CLI](https://github.com/Adnanarodiya/crawlwise-cli) is the same gate anywhere Node 22 runs:

```bash
npx crawlwise audit "$PREVIEW_URL" --fail-on 'score<80' --fail-on 'fixes>0'
```

MIT licensed. [Setup for every agent and CI](https://crawlwise.site/integrations).
