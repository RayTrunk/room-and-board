---
title: Photos and video
description: iCloud Shared Albums, public Google Drive folders, the built-in Landscapes folder, and UniFi or HLS live video.
---

Five cards in the Images group. Every still-image card opens full screen on a
tap and swipes to browse there. All of them decode the next image before
swapping it in and cross-fade between the two, so a half-painted photo never
reaches the glass. All but NASA can drive the screensaver.

## Art

A rotating public domain artwork from the Met, the Art Institute of Chicago and
Cleveland. This is the default screensaver source.

**Configure:** Settings → Art. Rotation interval, and optional collections.

## Landscapes

The same slideshow machinery pointed at a built-in, hand-curated folder, so it
needs no setup at all. Add the card and it works.

**Configure:** Settings → Landscapes. Rotation interval only, since the folder
is baked in.

## iCloud Photos and GDrive Photos

Rotating slideshows from an iCloud **Shared Album** and/or a **public Google
Drive folder**. They are two independent widgets: add either or both, each with
its own album and rotation interval. On the dashboard both cards are titled
simply "Photos".

**Configure:** from your phone at `/photo-setup`. Each widget's Settings pane
shows a QR straight to it. The page walks through creating the shared album or
folder, checks your link against the live feed, and mints a short board code.
One code covers either source or both, and entering it changes only the photo
slots it carries.

Google Drive needs a free API key on the Worker.

:::caution[The album is public]
The album or folder is shared with a public link. Anyone with the link can view
the photos, so add only office-appropriate ones.
:::

## NASA Daily Photo

NASA's Astronomy Picture of the Day: the image plus its title, tapping through
to full screen with the explanation. Changes once a day, and video days are
skipped automatically.

**Configure:** nothing. Uses a free NASA key on the Worker.

## Live Video

A gated card. It takes either a UniFi Protect Share-Livestream link
(`monitor.ui.com/...`, embedded via UI's own player) or a live HLS stream (your
own HTTPS `.m3u8` link), playing muted on the card via a vendored hls.js, since
RoomOS's Chromium has no native HLS.

No stream is bundled. Paste and preview the link at `/video-setup` on your
phone, then type the short code on the board.

**Configure:** Settings → Live Video, or `/setup` → Live Video.

Live Video is one of the five cards with nothing behind a tap on the dashboard.
