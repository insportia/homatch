# Georgian speech fixture

`ka-selftest.pcm` — 6.32 seconds, 16 000 Hz, mono, signed 16-bit little-endian
(LINEAR16). Exactly the format `/speech/stream` expects, so the self-test feeds
the recogniser the same bytes a browser's microphone pipeline produces and not
a decoded approximation of them.

**What is said:**

> გამარჯობა, მე მარიამი ვარ, Homatch-ის AI ასისტენტი. რით შემიძლია დაგეხმაროთ?

**Where it came from:** ElevenLabs `eleven_v3_conversational`, voice `mariam`
(`Eb4eQulvcrZuMDMq80k6`), `language_code: ka`, synthesised at 24 kHz through
Homatch's own production TTS path on 2026-09-14 and resampled to 16 kHz.

**Why synthetic and not a real recording.** A real microphone clip of a real
Georgian speaker would be somebody's voice, committed to a repository, replayed
on every self-test for as long as this service exists. There is no consent that
makes that a good idea for a health check. This clip is the assistant's own
voice saying the assistant's own opening line, which nobody has a privacy
interest in.

It is deliberately NOT a substitute for testing with real speakers. It proves
the pipeline carries Georgian audio to Google and brings Georgian text back. It
proves nothing about accents, background noise, or how a person actually talks
to this product — those need real users, and this file must never be cited as
though it covered them.

**Why the expected text matters.** The self-test knows what this clip says, so
it can report whether the transcript resembles it rather than only whether
*some* bytes came back. A recogniser that is quietly configured for the wrong
language still returns a confident string; comparing against known Georgian is
what makes that visible.
