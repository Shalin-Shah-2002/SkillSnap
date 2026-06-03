var $=["Identify the user's task and confirm it matches the skill description.","Apply the source-derived workflow and adapt it to the user's concrete context.","Call out assumptions, limitations, and missing information before giving final output."];function A(e,t="youtube-video-skill"){return e.toLowerCase().replace(/['"]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-").slice(0,48).replace(/^-+|-+$/g,"")||t}function C(e,t){let n=A(e.skillName||t.title),i=u(e.displayName,M(n)),r=u(e.description,`Use when an agent needs to apply the method or knowledge from "${t.title}".`);return{skillName:n,displayName:i,description:f(r).slice(0,220),triggerGuidance:u(e.triggerGuidance,r),workflow:d(e.workflow,$),importantDetails:d(e.importantDetails,["Use the source notes as grounding material and avoid adding unsupported details."]),limitations:d(e.limitations,["This skill is grounded in captions from a single YouTube video."]),videoSummary:u(e.videoSummary,`Source video: ${t.title} by ${t.channel}.`),referenceNotes:d(e.referenceNotes,["Review the source metadata and transcript-derived summary before applying the workflow."])}}function k(e,t){let n=C(e,t),i=b(n,t),r=E(t);return{sourceVideo:t,draft:n,codex:{skillName:n.skillName,skillMd:T(n),referenceMd:i,transcriptMd:r},claude:{skillName:n.skillName,skillMd:G(n),referenceMd:i,transcriptMd:r}}}function T(e){return`---
name: ${s(e.skillName)}
description: ${s(e.description)}
metadata:
  short-description: ${s(e.displayName)}
---

# ${e.displayName}

## When To Use

${e.triggerGuidance}

## Workflow

${y(e.workflow)}

## Important Details

${a(e.importantDetails)}

## Limitations

${a(e.limitations)}

## Source Reference

When source grounding matters, read \`references/video-summary.md\` for the brief summary and \`references/full-transcript.md\` for the full transcript.
`}function G(e){return`---
name: ${s(e.skillName)}
description: ${s(e.description)}
---

# ${e.displayName}

## When To Use

${e.triggerGuidance}

## Process

${y(e.workflow)}

## Source-Grounded Notes

${a(e.importantDetails)}

## Boundaries

${a(e.limitations)}

## Reference

Use \`references/video-summary.md\` for the brief summary and \`references/full-transcript.md\` for the full transcript.
`}function b(e,t){return`# Video Summary

${e.videoSummary}

## Source

- Title: ${t.title}
- Channel: ${t.channel}
- URL: ${t.url}
- Video ID: ${t.videoId}
- Caption source: ${t.transcriptSource}
- Caption language: ${t.captionLanguage||"unknown"}
- Captured at: ${t.capturedAt}

## Reference Notes

${a(e.referenceNotes)}
`}function E(e){return`# Full Transcript

## Source

- Title: ${e.title}
- Channel: ${e.channel}
- URL: ${e.url}
- Video ID: ${e.videoId}
- Caption source: ${e.transcriptSource}
- Caption language: ${e.captionLanguage||"unknown"}
- Captured at: ${e.capturedAt}

## Transcript

${e.transcript}
`}function d(e,t){if(!Array.isArray(e))return t;let n=e.map(i=>f(String(i))).filter(Boolean);return n.length>0?n:t}function u(e,t){return typeof e!="string"?t:e.trim()||t}function f(e){return e.replace(/\s+/g," ").trim()}function s(e){return JSON.stringify(f(e))}function a(e){return e.map(t=>`- ${t}`).join(`
`)}function y(e){return e.map((t,n)=>`${n+1}. ${t}`).join(`
`)}function M(e){return e.split("-").filter(Boolean).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" ")}var m="gemini-2.5-flash",S=[m,"gemini-flash-latest","gemini-2.0-flash"],p={geminiApiKey:"",geminiModel:m};function h(e){return e.geminiApiKey.trim().length>0}function L(e,t=9e4){if(e.length<=t)return e;let n=Math.floor(t/2);return[e.slice(0,n),`

[Transcript trimmed for length. Middle omitted.]

`,e.slice(e.length-n)].join("")}function w(e,t){return`You are generating reusable AI agent skills from a YouTube transcript.

Return only valid JSON. Do not wrap it in markdown fences.

Create one source skill concept that can be rendered into both Codex and Claude skill packages.
The generated skill must teach an AI agent how to perform the method, workflow, or domain task shown in the video. It must not merely summarize the video.

Use this exact JSON shape:
{
  "skillName": "kebab-case-name",
  "displayName": "Human readable skill name",
  "description": "One concise trigger description for when an agent should use this skill.",
  "triggerGuidance": "A concise paragraph explaining when to use this skill.",
  "workflow": ["ordered step", "ordered step"],
  "importantDetails": ["durable technique, rule, checklist item, or concept"],
  "limitations": ["when not to use this skill or what the transcript did not establish"],
  "videoSummary": "Short factual source summary.",
  "referenceNotes": ["source-derived supporting note", "source-derived supporting note"]
}

Rules:
- Keep skillName kebab-case, lowercase, under 48 characters.
- Preferred skill name: ${t?.trim()||"derive a clear kebab-case name"}
- Base the skill only on the transcript and metadata.
- If the transcript is thin, say so in limitations instead of inventing facts.
- Make workflow steps actionable for agents like Codex and Claude.
- Keep description under 180 characters.
- Avoid references to "this video" in the main workflow; the skill should stand alone.

Video metadata:
Title: ${e.title}
Channel: ${e.channel}
URL: ${e.url}
Caption language: ${e.captionLanguage||"unknown"}

Transcript:
${L(e.transcript)}`}var R=/AIza[0-9A-Za-z\-_]{20,}/g;async function x(e){let{apiKey:t,model:n,video:i,preferredSkillName:r}=e,g=P(n),o=null;for(let l of g)try{return await D({apiKey:t,model:l,video:i,preferredSkillName:r})}catch(c){if(!(c instanceof Error)||!I(c))throw c;o=c}throw o||new Error("No compatible Gemini Flash model was available.")}async function D(e){let{apiKey:t,model:n,video:i,preferredSkillName:r}=e,g=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(n)}:generateContent`,o=await fetch(g,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":t},body:JSON.stringify({contents:[{role:"user",parts:[{text:w(i,r)}]}],generationConfig:{temperature:.2,responseMimeType:"application/json"}})}),l=await o.json();if(!o.ok)throw new Error(K(l.error?.message,o.status));return v(O(l))}function P(e){let t=e.trim(),n=t.toLowerCase().includes("flash")?[t]:[];return Array.from(new Set([...n,m,...S]))}function I(e){let t=e.message.toLowerCase();return t.includes("not found")||t.includes("unsupported")||t.includes("is not found")||t.includes("unexpected model")||t.includes("does not exist")}function K(e,t){let n=_(e||"").trim(),i=n.toLowerCase();return i.includes("consumer")&&i.includes("suspended")?"This Gemini API key has been suspended. Open Settings and replace it with a new active key.":i.includes("api key not valid")||i.includes("invalid api key")?"This Gemini API key is invalid. Open Settings and paste a valid Gemini API key.":i.includes("permission denied")||i.includes("access denied")?"Gemini rejected this API key. Check that the key is active and allowed to use the Gemini API, then try again.":t===429?"Gemini rate-limited this request. Wait a moment and try again.":n||`Gemini request failed with ${t}.`}function _(e){return e.replace(R,"[redacted-api-key]")}function O(e){let t=e.candidates?.[0]?.content?.parts?.map(n=>n.text||"").join("");if(!t?.trim())throw new Error("Gemini returned an empty response.");return t}function v(e){let t=U(e.trim());try{return JSON.parse(t)}catch{let n=t.indexOf("{"),i=t.lastIndexOf("}");if(n>=0&&i>n)return JSON.parse(t.slice(n,i+1));throw new Error("Gemini did not return valid skill JSON.")}}function U(e){return e.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim()}chrome.runtime.onMessage.addListener((e,t,n)=>(F(e).then(i=>n({ok:!0,data:i})).catch(i=>n({ok:!1,error:i instanceof Error?i.message:"The extension could not complete that request."})),!0));async function F(e){if(e.type==="GET_SETTINGS_STATUS"){let t=await N();return{hasKey:h(t)}}if(e.type==="GENERATE_SKILLS"){let t=await N();if(!h(t))throw new Error("Add a Gemini API key in extension settings first.");let n=await x({apiKey:t.geminiApiKey.trim(),model:t.geminiModel.trim()||p.geminiModel,video:e.video,preferredSkillName:e.preferredSkillName});return k(n,e.video)}throw new Error("Unsupported extension request.")}function N(){return new Promise(e=>{chrome.storage.local.get(p,t=>{e({geminiApiKey:String(t.geminiApiKey||""),geminiModel:String(t.geminiModel||p.geminiModel)})})})}
