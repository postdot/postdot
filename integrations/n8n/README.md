# Postdot for n8n

Create publication drafts in [Postdot](https://postdot.app) from your n8n workflows. Send text from a form, feed or another workflow step to a Postdot project, choose a channel, and review the draft in Postdot Studio.

This community node supports **self-hosted n8n**. It is an alpha release, tested with n8n 2.45.6, and is not verified for n8n Cloud.

## Install

You need a running Postdot instance that n8n can reach and permission to install community nodes in n8n.

1. In n8n, open **Settings > Community Nodes** and select **Install**.
2. Enter `@postdot/n8n-nodes-postdot@alpha` as the package name.
3. Review the community node notice and select **Install**.

Add a node to your workflow and search for **Postdot**.

For Docker, queue mode or installations managed from the command line, see [n8n's manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/). Use `@postdot/n8n-nodes-postdot@alpha` as the package name and keep the installation in n8n's persistent user directory.

## Connect your Postdot instance

In Postdot Studio, open **Settings > API keys**. Create a key limited to the project you want to use, with these actions:

- `project:read`
- `publication:manage`

In n8n, create a **Postdot API** credential and fill in:

| Field | Value |
| --- | --- |
| **Postdot URL** | Your instance address, such as `https://postdot.example`, without `/api` or another path. |
| **API Key** | The secret from the Postdot API key you just created. |

Save and test the credential. The test lists accessible projects. Store your API key in the credential so it stays out of workflow parameters and exports.

If n8n runs in Docker, use an address reachable from its container. `localhost` refers to the n8n container itself.

## Create your first draft

1. Add a **Manual Trigger** and connect a **Postdot** node.
2. Select your **Postdot API** credential.
3. Set **Resource** to **Post** and **Operation** to **Create Draft**.
4. Select a project and channel, then enter your **Text**. You can use an n8n expression to read text from an earlier step.
5. Choose **Automatic** for a connected publishing destination, or **Manual** for a channel you publish yourself.
6. Execute the workflow once, then open **Queue** in Postdot Studio to review the draft.

Both delivery modes save an unscheduled draft. The node prepares plain text for one channel; review it in Studio before scheduling or publishing. Channels that require media will need further editing.

Create Draft returns a `post` and a `publications` array. To read the saved publication in a later node, use **Publication > Get** with the same project and this **Publication ID** expression:

```js
{{ $json.publications[0].id }}
```

You can also [download the example workflow](https://raw.githubusercontent.com/postdot/postdot/main/integrations/n8n/examples/create-draft.json) and import it into n8n. Select your credential on both Postdot nodes, then replace the project ID, channel ID and text in **Draft settings**. Use the operations below to find those IDs.

## Supported operations

| Resource | Operation | Result |
| --- | --- | --- |
| **Project** | **Get Many** | Lists the active projects your API key can access. |
| **Channel** | **Get Many** | Lists channels attached to the selected project. |
| **Post** | **Create Draft** | Creates a post and one unscheduled, text-only publication for each input item. |
| **Publication** | **Get** | Reads a publication's saved draft, state, selected target and recorded outcome. |

This version supports draft creation and reads. Upload media, connect publishing accounts, schedule and publish from Postdot Studio.

## If a request fails

Keep **Retry On Fail** disabled for **Create Draft**. A timeout or lost response may occur after Postdot saves the draft. Check Queue before running the creation again to avoid duplicates. Each input item creates a separate post, including items you send again in another run.

If your projects or channels do not appear, check the API key's project scope and actions. An invalid key returns `401`; insufficient permissions can return `403`, and a project outside the key's scope can return `404`.

## Help and license

See the [Postdot n8n guide](https://postdot.app/docs/n8n/) for more setup details, or [report an issue](https://github.com/postdot/postdot/issues) with your n8n version, package version and the failing operation. Remove API keys and private content from anything you share.

Licensed under [AGPL-3.0-only](https://github.com/postdot/postdot/blob/main/integrations/n8n/LICENSE).
