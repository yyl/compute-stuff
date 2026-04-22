+++
date = '2026-04-21T06:19:11-07:00'
draft = false
title = 'AI Chatbots Still Hallucinate Asking About Coding on the Go'
tags = ['ai', 'chatbot', 'ai chatbot', 'llm', 'coding agent', 'ai agent', 'github copilot', 'gemini', 'claude', 'chatgpt', 'mobile coding', 'hallucination']
+++

Recently I ask 3 AI chatbots (ChatGPT, Claude, Gemini) best setup for coding on mobile phones. Nowadays coding agents are so powerful, I am curious if there are viable options to use them on the phones since the work is really just chatting with them.
Surprisingly, the question leads to 2 out of 3 hallucinates. If you are interested in a mobile coding setup, and/or which AI chatbot didn’t hallucinate, keep reading.

## My prompt

Here is my full prompt:

> what are my options to utilize coding agents on the go with mobile phone? All my codebase are on Github. Break them down 2 scenarios: free or if I am willing to pay. I also have a Mac mini with 16GB so potentially I can run local agent but not sure how effective it can be. Finally I also have a Google Pro plan already
> 
> Also I don't want the IDE experience on mobile - ideally it should be more like prompt based experience
> 
> Also let's only consider the condition where it either integrates with Github or find a reliable and consistent way to access my codebase, and able to sync it to Github.

## Gemini: stubbornly hallucinating ★

* Free options: 
  * DIY: install an open-source model locally on my mac, then use some sort of SSH or VPN tunnel to access it from the mobile phone
  * Gemini web: upload entire codebase as zip and just talk through
* Paid options: 
  * Replit mobile app: a vibe-coding app that requires a subscription fee
  * Github copilot workspace: see below
  * DIY but with API model: same as DIY above but using an API-based model that require a paid API key to use

Its response looked decent until I realized GitHub Copilot Workspace was never a full product. It launched as [a technical preview in 2024](https://githubnext.com/projects/copilot-workspace) but [was shutdown in 2025](https://gist.github.com/idan/15f101b8ff4be8bebe17147c08995363). To be fair it indeed provides a way to [prompt agents to do coding tasks](https://github.blog/news-insights/product-news/github-copilot-workspace/#also-github-copilot-workspace-is-mobile-compatible) - quite forward-looking in 2024 (the mainstream coding agent, Claude Code, was launched in 2025). 

The problem is that Gemini is quite stubborn here. I first tried the “Double-check response” feature, but the only thing it corrected was the subscription pricing (colored red in the pic below), still claiming it includes a product that no longer exists (colored green in the pic below).

{{< figure src=/gemini_double_check_response_feature.png title="Look at the shiny \"double check\" feature..." >}}

{{< figure src=/gemini_double_check_response_not_working.png title="...too bad it did not work" >}}


I then explicitly asked it to verify if the product still exists. Instead of fact-checking, Gemini doubled down with total confidence, claiming it was “no longer locked behind a closed technical preview wait list”:

{{< figure src=/gemini_claim_workspace_exist.png title="Gemini so wrong but so confident" >}}

It finally corrected itself and apologized after I pasted the link to the shutdown announcement. While the "stubbornness" was funny, the real reason I gave Gemini a one-star review is that it completely missed the practical free option I ended up using. Check it out below.

## Claude: hallucinate but quick to correct ★★

* Free options: 
  * DIY: same as in Gemini
  * Github copilot free tier: the agent product integrated inside Github
* Paid options: 
  * Gemini advanced + Github extension: see below
  * Github copilot pro: paid version of copilot
  * DIY but with API model: same as in Gemini

Claude has a similar response as Gemini, but did a better job in 2 ways. 

First, it recommended GitHub Copilot’s free tier—the actual free option I ended up choosing. GitHub Copilot is a suite of products, but the relevant one for me is the chatbot inside the GitHub mobile app. It allows me to create a task by sending a prompt with the repo as context; the agent then scans the codebase, builds a plan, and eventually creates a PR for me to review. I tried a few small-to-medium tasks, and the results were decent.

{{< figure src=/github_copilot_mobile_app_screenshot.PNG title="Github Copilot mobile app screenshot" width="400px" >}}

The quota and model selection are understandably limited:
1. 50 requests per month
2. 3 small models: Anthropic Claude Haiku 4.5, GPT-5 mini, Raptor mini

Interetingly the constraints kinda fit the mobile style - simple tasks that do not require me to either type for too long or having too many turns of chat. 

The second thing Claude did well: it corrects its own hallucination fast. The best free option it recommends is to connect Github repo to Gemini mobile app:

{{< figure src=/claude_rec_gemini_advanced_wrong_screenshot.PNG title="Claude is hallucinating too" >}}

But then I try to find it in the app - it does not exist! Fortunately Claude corrects it in one turn:

{{< figure src=/claude_rec_gemini_advanced_corrected.png title="Claude is being receptive" >}}

Later on it also correctly mentions that even on web the import is one-way. Basically Gemini reads the code once into its context, but can’t either make changes to the repo, or get new updates if code changes after the read.

## ChatGPT: best even if it looks fishy ★★☆

* Free options: 
  * Github copilot free tier: the agent product integrated inside Github
  * DIY: same as above
* Paid options:
  * Github copilot pro: paid version of copilot
  * Claude Code remote control
  * Replit mobile app

Claude has a similar response as Gemini, but did a better job in 2 ways.

This chat earns the most stars for 2 primary reasons. The first it did not hallucinate at all - I thought this was a low bar to clear in 2026 but apparently not! 

The second reason is that ChatGPT is the only one who mentions [Claude Code Remote Control](https://x.com/claudeai/status/2026418433911603668) (as part of the DIY solution). It has its own limitations (paid only, requires desktop setup, etc), but it is actually one of the most powerful option since it is full featured Claude Code.

The one minor issue is questionable citations. ChatGPT seemingly gets the specific Claude Code Remote Control from a content farm. It is a legit website but since it is a Claude Code feature why not just cite [Claude proper](https://code.claude.com/docs/en/remote-control)? Maybe the citations try to be diverse and comprehensive but it just makes the content itself less trustworthy. This is also why I deducted half star for it. Do better ChatGPT!

{{< figure src=/chatgpt_rec_citation_seo_fishy.png title="ChatGPT citation looks fishy content farm" >}}

## Summary: are AI chatbots useful in 2026?

Are these chatbots actually moving the needle on my mobile coding workflow? Honestly, I am aware of these tools mostly, GitHub Copilot included. I was hoping for a "hidden gem," but the only new insight was Gemini's GitHub integration—handy for a quick brainstorm, but not for actual coding. Ultimately, the chatbots just confirmed what I already knew: GitHub Copilot remains the choice for my case.

My takeaway: AI chatbots do not usually bring new insights to domains one is already familiar with, but they can be very useful for those one isn't. Nonetheless, thorough verification is essential!

## Is coding on mobile phones even a good idea

Ultimately, why bother with mobile coding? To be clear, I’m not trading in my full laptop keyboard for a touchscreen anytime soon; my heavy lifting still happens there. However, the real value is in closing the loop.

When I’m away from my desk but a task is nearly complete, mobile agents are perfect for those final, well-defined tweaks. For example:

1. Investigate failures: If I push a feature and the tests fail, I can prompt an agent to investigate the logs and apply a fix while I'm on the move.
2. Incremental features: If I’ve built a module to export JSON, I can quickly prompt the agent to expand that logic to support CSV as well.

These tasks don't require building or designing something from scratch. Because they are simple to describe and easy to delegate, they represent the perfect work carved out for agents.