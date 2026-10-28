# PDF, video and link menus

In **Lead Capture**, choose **PDF / Video / Link Menu**. Select the WhatsApp session, enter the words that start the menu, and configure a public URL for each choice. Save and enable the flow. Each choice can send a PDF/document, a video file, or a text link, with an optional message and document filename. No AI API key is required.

## Two delivery modes

**QR-connected WhatsApp Web or Baileys:** the menu appears as a single-choice poll. The customer selects a choice and taps **Vote**. Customers can also type the exact option label. Add 2–12 choices.

**Meta WhatsApp Business API:** the menu appears with native reply buttons. The customer taps a button and receives the selected resource. Enable **Also use native Business API buttons** on the first question of the flow. Use 2–3 choices with unique titles of up to 20 characters, a prompt of up to 1024 characters, and a resource for every choice. The same flow can serve QR sessions through polls and the Business API number through buttons. The limits follow Meta's [interactive message](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/) and [reply button](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/ButtonObject/) documentation.

## Connect a Business API number

1. An administrator configures the existing `STUDIO_VAULT_KEY` server setting: a base64-encoded 32-byte key. Keep it stable and backed up so saved credentials remain decryptable.
2. In Lead Capture, select a specific session and open **WhatsApp Business API — Native Reply Buttons**. The session groups the configuration; the Cloud API uses the Meta Phone Number ID entered here, independently of the QR engine.
3. Enter the **Meta Phone Number ID**, a supported **Graph API version**, **Access Token**, and **Meta App Secret**. Enable native responses and save. Credentials are encrypted at rest and never returned by the API. Leave credential fields blank to retain existing values when editing.
4. Copy the callback URL and the one-time Verify Token into your Meta app's WhatsApp webhook settings. Subscribe to the **messages** webhook. If the Verify Token is lost, generate a new one and update it in Meta. Incoming POST requests require a valid `X-Hub-Signature-256`, following Meta's [webhook verification](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) contract.
5. Create the resource menu, enable its native-buttons checkbox, save it and send its trigger word to the **Business API number** from a customer account. Tap each button and confirm its resource arrives. Use the QR-connected number to test the poll mode.

The API sends responses to incoming customer messages. This menu feature does not send unsolicited campaigns or create message templates. Provider permissions, number registration, webhook subscriptions and valid credentials must be configured in Meta before live delivery can be verified.

## Resource behavior

Selecting a resource completes that interaction and sends only that choice's resource, without the generic completion message or generic completion attachments. In poll flows, choices configured as **Continue to next question** retain ordinary questionnaire behavior. Invalid typed answers repeat the menu without advancing. Customers can send the start keyword again to request another resource.

PDF/document and video URLs must point directly to publicly accessible files. For a video hosted on a website such as YouTube, choose **Send link**. Existing QR media limits and URL protections apply. Cloud API media support and limits are enforced by Meta.

The Visual Studio simulator previews the configured message and resource URL without sending WhatsApp messages. Test actual file delivery with a second WhatsApp account.

## Reliability and deployment

The data migration `1792840000000-AddCloudResourceMenus` creates the encrypted connection and persistent webhook receipt tables. Deploy the backend and dashboard together and run the normal data migrations. Step-level resource mappings remain in the existing JSON step data. Disabling the connection pauses native responses; disabling the flow stops both modes.

Webhook receipts deduplicate repeated inbound messages. A native selection is bound to its connection, customer, original outgoing menu and current flow definition. Only one resource can be claimed per menu. If a Cloud API request fails, the webhook fails so Meta can retry the same selection. Delivery has the normal at-least-once boundary of an external API: a crash after provider acceptance but before local acknowledgement can duplicate a send. A receipt with an active processing lease retries after the lease expires. Reconnecting with fresh credentials is possible after a vault-key change.

QR sends use the existing message pipeline and its failure logs. If a QR attachment fails, correct the URL or connection and restart the menu. No additional QR delivery retry queue is introduced.

## Step API example

```json
{
  "key": "resource",
  "question": "What would you like?",
  "nativeButtons": true,
  "options": ["PDF", "Video", "Website"],
  "deliveries": [
    { "option": "PDF", "type": "document", "url": "https://example.com/course.pdf", "filename": "course.pdf" },
    { "option": "Video", "type": "video", "url": "https://example.com/intro.mp4" },
    { "option": "Website", "type": "link", "url": "https://example.com/course", "caption": "Open the course here:" }
  ]
}
```

Admin-only connection settings live at `GET/PUT /api/sessions/:sessionId/cloud-resource-menu`; verification tokens rotate at `POST .../rotate-token`. The public Meta webhook supports `GET/POST /api/whatsapp-cloud-menus/:connectionId`, with challenge-token verification for GET and raw-body signature verification for POST.

## Validation notes

Automated checks cover native message payloads, signed webhook verification, recipient/menu binding, deduplication, retry after provider failure, credential encryption, disabled flows, poll selections, and the ordinary automation send pipeline. Browser checks use local API fixtures to verify connection setup, callback URL generation, resource-menu saving and reopening, and mobile layout; they do not send real WhatsApp messages.

The wider repository schema snapshot and global route-fence checks currently report mismatches in other existing tables/routes. The cloud-menu tables introduce no schema-drift entries, and the new connection endpoints are session scoped and admin-only; the public callback verifies Meta signatures. These broader failures remain outside this feature. Live Meta delivery and PostgreSQL migration execution require the deployment environment and credentials.
