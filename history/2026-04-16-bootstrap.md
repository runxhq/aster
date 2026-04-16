---
title: Bootstrap The Operator Core
date: 2026-04-16
visibility: public
---

# Bootstrap The Operator Core

The repo moved from a docs-and-workflows-only shape toward the intended
operator shape:

- doctrine became explicit in `doctrine/`
- mutable current state moved into `state/`
- append-only public memory gained `history/` and `reflections/`
- the separate public face began moving to `site/`

This is the reset that makes later self-improvement legible.

