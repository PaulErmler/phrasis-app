"""
Translation prompts under evaluation.

Two variants:
  - PROMPT_A_PURE_PROSE: WMT24++-style flat prose (good for smaller / quantized models)
  - PROMPT_B_XML_STRUCTURED: Gemini-3-aligned, XML-structured (the recommended default)

Both render the same six fields:
  tgt_lang_name, tgt_code, tgt_region, speaker_gender, addressee_gender, formality, src

`render_prompt` below strips lines whose metadata field is empty / None, so an
unspecified `speaker_gender` doesn't leak the literal word into the prompt.
"""

from __future__ import annotations
from typing import Optional


# Prompt A — pure-prose (minimal, robust). Best for smaller models.
PROMPT_A_PURE_PROSE = """You are a professional translator translating from English into {tgt_lang_name} ({tgt_code}), suitable for use in {tgt_region}. Translate the text below.

Context:
- The speaker is {speaker_gender}.
- The text is addressed to a {addressee_gender} addressee.
- Use a {formality} register (the language's standard polite register if formal; the language's casual register if informal; the default register if neutral).
- If the target language does not grammatically encode any of these features, translate naturally and ignore them.

Text to translate: {src}

Produce only the {tgt_lang_name} translation. No commentary, no quotation marks, no explanations, no alternatives."""


# Prompt B — XML-structured natural-language (Gemini 3-aligned).
PROMPT_B_XML_STRUCTURED = """You are a professional English-to-{tgt_lang_name} translator. Translate the text inside <source> tags into {tgt_lang_name} ({tgt_code}), suitable for {tgt_region}.

<context>
  <speaker_gender>{speaker_gender}</speaker_gender>
  <addressee_gender>{addressee_gender}</addressee_gender>
  <register>{formality}</register>
</context>

<instructions>
Use the supplied speaker and addressee gender for any grammatical agreement (verb conjugation, adjective inflection, pronoun choice) the target language requires. Use the requested register: 'informal' = the language's casual T-form (du/tú/tu); 'formal' = the language's standard polite V-form or honorific (Sie/usted/vous/敬語 ます-form); 'neutral' = the language's default register for written prose. If the target language does not grammatically encode a given feature, translate naturally and ignore it. Do not output any field as a literal word.
</instructions>

<source>{src}</source>

Output only the {tgt_lang_name} translation of the text inside <source>. No commentary, no tags, no quotation marks, no alternatives."""


# Which lines belong to which metadata field — used to strip lines when the
# field is empty / None. Keeps the prompts honest when metadata is missing.
_A_LINE_OWNERSHIP = {
    "speaker_gender":   "- The speaker is {speaker_gender}.",
    "addressee_gender": "- The text is addressed to a {addressee_gender} addressee.",
    "formality":        "- Use a {formality} register",
}


def render_prompt(
    template: str,
    *,
    tgt_lang_name: str,
    tgt_code: str,
    tgt_region: str,
    speaker_gender: Optional[str],
    addressee_gender: Optional[str],
    formality: Optional[str],
    src: str,
) -> str:
    """Fill a prompt template, removing/blanking metadata lines whose value is missing.

    For Prompt A we drop the whole context-bullet line if its field is empty.
    For Prompt B we replace the empty value with the string 'unspecified' so
    the XML tag remains well-formed (and the model is explicitly told the field
    is unspecified, which is exactly what we want).
    """
    # Prompt-A path: detect by the leading "You are a professional translator"
    # rather than identity comparison so the function still works if a caller
    # passes a string copy.
    if template.startswith("You are a professional translator translating"):
        lines = template.split("\n")
        filtered: list[str] = []
        for line in lines:
            keep = True
            for field, marker in _A_LINE_OWNERSHIP.items():
                if line.startswith(marker.split("{")[0]):
                    value = {
                        "speaker_gender": speaker_gender,
                        "addressee_gender": addressee_gender,
                        "formality": formality,
                    }[field]
                    if value is None or value == "":
                        keep = False
                    break
            if keep:
                filtered.append(line)
        template = "\n".join(filtered)
        return template.format(
            tgt_lang_name=tgt_lang_name,
            tgt_code=tgt_code,
            tgt_region=tgt_region,
            speaker_gender=speaker_gender or "",
            addressee_gender=addressee_gender or "",
            formality=formality or "",
            src=src,
        )

    # Prompt-B path: XML tags stay; missing values become 'unspecified'.
    return template.format(
        tgt_lang_name=tgt_lang_name,
        tgt_code=tgt_code,
        tgt_region=tgt_region,
        speaker_gender=speaker_gender or "unspecified",
        addressee_gender=addressee_gender or "unspecified",
        formality=formality or "unspecified",
        src=src,
    )
