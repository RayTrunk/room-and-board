---
title: The configuration string
description: How a board's configuration is encoded, where it is stored, and how a wiped board re-seeds itself.
---

A board's entire configuration is **deflate plus base64url JSON**, roughly 200
characters.

## Where it lives

| Store | Role |
| --- | --- |
| `localStorage` | The primary store on every touch board |
| The `#cfg=` URL fragment | An optional second copy, riding the signage URL |

`localStorage` survives reboots and RoomOS upgrades. It does not survive a web
storage wipe.

The URL fragment does, by definition, which is the whole point of the non-touch
path.

## Setup codes

A setup code is six characters, lives for one hour, and works once.

The flow:

1. The board shows a welcome screen. You visit `/setup` on your phone, pick
   widgets and stations, and tap **Get my setup code**.
2. On the board: gear → **Setup code** → type the six characters → Save.
3. Later edits happen directly on the touchscreen, or gear → Setup code →
   **Show QR** to pull the current config back to a phone.

There are narrower codes too: `/photo-setup` mints a photos-only code, and
`/video-setup` a video-only one. Entering one of those changes **only** the
slots it carries and leaves the rest of your configuration alone.

## Config versions

Layouts live in config v3. Older v1 and v2 configs migrate automatically on
first load, so an old QR or URL still works.

## The disaster drill

This verifies that a board can rebuild itself from its URL. For boards whose
signage URL carries the configuration:

```
xCommand WebEngine DeleteStorage Type: Signage
```

Then put the board in standby and wake it. The page re-seeds from the URL's
`#cfg` fragment and the dashboard returns configured.

:::caution[Setup-code boards behave differently]
A board left on the default signage URL keeps its config only in web storage.
There `DeleteStorage` erases it and the board returns to the welcome screen.
Re-enter a setup code to restore it.
:::

## What the URL does not carry

Nothing sensitive. The exported URL contains only `#cfg=`.

Early macro builds also minted a rotating low-privilege device account and
carried its credentials in an `auth` fragment for a page-to-device back-channel.
That feature was dropped, and the client half was removed in August 2026. An old
URL still carrying an `auth` fragment is simply ignored, the same as any other
unknown fragment key.
