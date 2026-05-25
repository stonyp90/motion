# CI/CD setup — landing the workflows

The initial push didn't include `.github/workflows/` because the local
`gh` token doesn't have the `workflow` OAuth scope. The workflow files
are committed locally on a follow-up commit — they just need a token
with the right scope (or a manual web-UI add) to land on GitHub.

## Option A — refresh your `gh` token (recommended, 30 seconds)

```bash
gh auth refresh -h github.com -s workflow
# Opens a browser, asks you to confirm the new scope
git push
```

That's it — the local follow-up commit (`ci: add engine + web + azure
deploy workflows`) gets pushed and the three workflows show up in the
repo's Actions tab.

## Option B — add via the GitHub web UI

If you'd rather not refresh the token, the three YAMLs are committed
locally under `.github/workflows/`. Copy each into the web editor:

1. https://github.com/stonybespoke/motion/new/main?filename=.github%2Fworkflows%2Fengine-ci.yml
2. https://github.com/stonybespoke/motion/new/main?filename=.github%2Fworkflows%2Fweb-ci.yml
3. https://github.com/stonybespoke/motion/new/main?filename=.github%2Fworkflows%2Fazure-deploy.yml

Then locally:
```bash
git pull --rebase
```

## Repository secrets to add

Once the workflows are landing, Settings → Secrets and variables →
Actions → New repository secret, three values:

| Name | Where to get it |
|---|---|
| `AZURE_CLIENT_ID` | The User-Assigned Managed Identity's clientId — `az identity show -g rg-motion-forge-dev -n mid-mf-dev-75mfz5z7mpzxk --query clientId -o tsv` |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |

Then create a **federated credential** on that Managed Identity so
GitHub Actions can OIDC-sign-in without a client secret:

```bash
az identity federated-credential create \
  --name github-main \
  --identity-name mid-mf-dev-75mfz5z7mpzxk \
  --resource-group rg-motion-forge-dev \
  --issuer https://token.actions.githubusercontent.com \
  --subject "repo:stonybespoke/motion:ref:refs/heads/main" \
  --audiences api://AzureADTokenExchange
```

After that:

- Push to `main` touching `engine/**` → `engine-ci.yml` + `azure-deploy.yml` run
- Push to `main` touching `web/**` → `web-ci.yml` runs
- Manual deploy: Actions tab → "engine · Azure deploy" → Run workflow
