# Deployment and distribution

[Project overview](../README.md) · [Development](development.md) · [Browser access](browser-access.md)

tabs.chat is a static browser application. Hosting serves application files; AI and MCP requests go from the browser to the configured endpoints. Provider CORS requirements still apply.

## Portable files

```sh
npm run build
```

Distribute `dist/tabs-chat.html` (Normal) and `dist/tabs-chat-lite.html` (Lite). Each is one self-contained HTML file that can be opened directly or served from a static host. Normal also has entrypoint copies at root `index.html` and `dist/index.html`.

Users' settings, credentials and conversations remain in browser storage; they are not written into the generated HTML during ordinary builds. Use JSON export/import to move user data. Moving between a local file and a hosted origin changes the storage context.

## Static hosting

For the hosted distribution:

```sh
npm run build:hosted
```

Publish the **contents** of `dist-hosted/` as the site's document root, preserving the directories:

```text
index.html
css/
js/
vendor/
assets/
LICENSE
THIRD_PARTY_NOTICES.txt
```

Use HTTPS and serve HTML, CSS, JavaScript/ES modules and fonts with their appropriate content types. Dependencies are served from the same site; Mermaid and PDF.js load on demand. Keep the license and notice files with the distribution.

For a static hosting build configuration, set the build command to `npm run build:hosted` and the publish directory to `dist-hosted`. `dist-hosted/` is ignored by Git; generate and upload it in your publication workflow. A single standalone file can also be hosted as `index.html` when separate resources are unnecessary.

The hosted PWA manifest and service worker are not yet included; PWA installation is deferred. The canonical site is `https://tabs.chat`; `https://www.tabs.chat` redirects permanently to it, preserving paths, query parameters and browser-held fragments.

## Included AWS deployment

The repository provides [deploy.sh](../deploy/deploy.sh), [upload.sh](../deploy/upload.sh) and a [CloudFormation template](../deploy/s3-cloudfront.yaml). They create a private, encrypted, versioned S3 bucket, CloudFront distribution and Origin Access Control. The certificate must first be issued by ACM in `us-east-1` and cover both `tabs.chat` and `www.tabs.chat`; `www` serves only a redirect.

With AWS CLI credentials configured for the target account:

```sh
AWS_PROFILE=your-profile AWS_REGION=eu-west-1 \
CERTIFICATE_ARN=arn:aws:acm:us-east-1:ACCOUNT:certificate/CERTIFICATE \
npm run deploy:aws
```

The script:

1. Builds `dist-hosted/`.
2. Creates or updates CloudFormation stack `tabs-chat-stack`, in `AWS_REGION` or `eu-west-1` by default.
3. Reads the bucket, distribution ID and distribution URL from stack outputs.
4. Synchronizes the build to the bucket with `--delete`, removing remote files absent from the build.
5. Uploads supporting files first and `index.html` last. Stable asset paths use immediate revalidation; ESM files receive an explicit JavaScript MIME type.
6. Invalidates `/*`, waits for completion and prints the canonical URL.

The template configures the domain aliases, HTTPS certificate, security headers, cache policy and CloudFront Function redirect. DNS remains at Spaceship: keep ACM's validation CNAMEs for renewal, set an apex ALIAS to the `CloudFrontDomain` stack output, and point the `www` CNAME at the same CloudFront domain. Do not copy CloudFront's current IP addresses into A records.

The S3 bucket is retained if the stack is removed. Object versioning supports recovery; no immutable caching is applied to files whose names stay unchanged between releases.

## GitHub release automation

[CI](../.github/workflows/ci.yml) checks committed history with Gitleaks, installs locked dependencies, runs unit/browser/offline checks, and builds standalone plus hosted artifacts. It runs on main pushes and pull requests and is reused by the [Release workflow](../.github/workflows/release.yml).

Push an annotated `v<package.json version>` tag to release. Tags containing a prerelease suffix are marked as GitHub prereleases. The workflow publishes `tabs-chat.html`, `tabs-chat-lite.html` and `SHA256SUMS`, then uploads the already-tested hosted artifact and validates the website/redirect.

AWS access uses the role in [github-oidc.yaml](../deploy/github-oidc.yaml), trusting only `repo:caporro@24509741/tabs.chat@1437494563:ref:refs/tags/v*`. The owner and repository IDs match this repository's [immutable OIDC subject](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims). Read `gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix` before provisioning for another repository, and pass that exact prefix as `OidcSubjectPrefix`. The role can upload/delete objects only in this site's bucket and invalidate only this CloudFront distribution. No long-lived AWS keys are stored in GitHub. The account's existing GitHub OIDC provider is reused.

Configure these repository Actions variables: `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_S3_BUCKET`, and `AWS_CLOUDFRONT_DISTRIBUTION_ID`. Provision infrastructure separately with the AWS CLI profile; the release role cannot edit infrastructure or IAM.

For a failed deployment, rerun the failed Release job after resolving its cause. To restore a previous version, download that release run's hosted artifact and call `bash deploy/upload.sh RESTORED_BUILD BUCKET DISTRIBUTION`; the upload helper invalidates caches after restoring files.

## Publication artifacts

Build both standalone editions in CI and retain both HTML files as downloadable artifacts. For a hosted release, build and publish the entire hosted output as a separate operation. Keep the dependency lockfile, vendored resources and notices consistent; builds verify them before emitting artifacts.

Shared links work in both editions. Construct links with the actual app URL, keeping any subdirectory or HTML filename; see the [link reference](link-format.md). Configuration fragments are processed in the browser; provider and MCP requests go to the configured services.
