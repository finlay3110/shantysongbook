# Fonts

Both fonts here are licensed under the SIL Open Font License 1.1, which
permits bundling and redistribution with an application.

## Exo 2 — `exo2-latin.woff2`, `exo2-latin-ext.woff2`
Copyright 2013 The Exo 2 Project Authors (https://github.com/NDISCOVER/Exo-2.0)
Licence: SIL Open Font License 1.1 — https://openfontlicense.org/
Source: Google Fonts (https://fonts.google.com/specimen/Exo+2), latin and
latin-ext subsets of the variable font, weights 300-700.

## OpenDyslexic — `opendyslexic-latin-400-normal.woff2`, `opendyslexic-latin-700-normal.woff2`
Copyright (c) 2019-07-29 Abbie Gonzalez (https://abbiecod.es), with Reserved
Font Name OpenDyslexic.
Licence: SIL Open Font License 1.1 — https://openfontlicense.org/
Source: the `@fontsource/opendyslexic` package (latin subset).

## Why these are committed rather than loaded from a CDN
The app is used at events with poor or no connectivity. When these were
fetched from Google Fonts and jsDelivr, both silently failed offline —
including the dyslexia-friendly face, which is an accessibility setting
that should never depend on the network. They are now served from this
folder and precached by the service worker.
