#!/usr/bin/env python3
"""
Unified sentence processing: moderation and classification.
Handles both standalone classification and combined moderation+classification pipelines.
"""

import csv
import json
import os
import random
import time
from datetime import datetime
from pathlib import Path
from openai import OpenAI
from pydantic import BaseModel, Field, field_validator

try:
    from dotenv import load_dotenv
    script_dir = Path(__file__).parent
    env_file = script_dir.parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

try:
    from .config import (
        MODELS,
        BATCH_SIZE,
        DELAY_BETWEEN_REQUESTS,
        INPUT_PRICE_PER_MILLION,
        OUTPUT_PRICE_PER_MILLION,
        MODERATION_BATCH_SIZE,
        MODERATION_DELAY,
        LOW_USEFULNESS_THRESHOLD,
        PROBLEMATIC_FLAGS,
        OPENROUTER_BASE_URL,
    )
except ImportError:
    # Fallback for direct execution
    from config import (
        MODELS,
        BATCH_SIZE,
        DELAY_BETWEEN_REQUESTS,
        INPUT_PRICE_PER_MILLION,
        OUTPUT_PRICE_PER_MILLION,
        MODERATION_BATCH_SIZE,
        MODERATION_DELAY,
        LOW_USEFULNESS_THRESHOLD,
        PROBLEMATIC_FLAGS,
        OPENROUTER_BASE_URL,
    )


class SentenceAnalysis(BaseModel):
    """Pydantic model for a single sentence analysis result."""
    usefulness: float = Field(
        ...,
        description="Usefulness score from 1-10 for language learners",
        ge=1.0,
        le=10.0
    )
    flags: list[str] = Field(
        default_factory=list,
        description="List of problematic content flags"
    )
    
    @field_validator('usefulness')
    @classmethod
    def validate_usefulness(cls, v):
        """Ensure usefulness is within valid range."""
        if not (1.0 <= v <= 10.0):
            raise ValueError(f"Usefulness must be between 1 and 10, got {v}")
        return v


class BatchAnalysisResponse(BaseModel):
    """Pydantic model for batch analysis response."""
    results: list[SentenceAnalysis] = Field(
        ...,
        description="Analysis results for each sentence in the batch"
    )


class SentenceProcessor:
    """Unified processor for sentence moderation and classification."""
    
    def __init__(self):
        """Initialize API clients."""
        self.moderation_client = self._get_openai_client()
        self.classification_client = self._get_openrouter_client()
        self.stats = {}
    
    def _get_openai_client(self) -> OpenAI | None:
        """Get OpenAI client for moderation API."""
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return None
        return OpenAI(api_key=api_key)
    
    def _get_openrouter_client(self) -> OpenAI:
        """Get OpenRouter client for classification."""
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY not found in environment")
        return OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
    
    def _resolve_paths(self, data_dir: str = None, **kwargs) -> dict:
        """Resolve file paths, using data_dir defaults if not provided."""
        if data_dir is None:
            script_dir = Path(__file__).parent
            data_dir = str(script_dir.parent / "data")
        
        data_path = Path(data_dir)
        output_path = data_path / "intermediate_outputs"
        output_path.mkdir(parents=True, exist_ok=True)
        
        defaults = {
            'input_file': output_path / "filtered_sentences.csv",
            'output_file': output_path / "classified_sentences.csv",
            'moderated_output_file': output_path / "filtered_sentences.csv",
            'classified_output_file': output_path / "classified_sentences.csv",
            'filtered_output_file': output_path / "filtered_out_sentences.csv",
        }
        
        resolved = {}
        for key, default in defaults.items():
            if key in kwargs and kwargs[key] is not None:
                resolved[key] = Path(kwargs[key])
            else:
                resolved[key] = default
        
        return resolved
    
    def _load_processed_ids(self, output_file: Path) -> set:
        """Load IDs of already processed sentences."""
        processed = set()
        if output_file.exists():
            with open(output_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f, delimiter='\t')
                for row in reader:
                    processed.add(row['id'])
        return processed
    
    def _format_time(self, seconds: float) -> str:
        """Format seconds into human readable string."""
        if seconds < 60:
            return f"{seconds:.1f}s"
        elif seconds < 3600:
            return f"{seconds/60:.1f}m"
        elif seconds < 86400:
            return f"{seconds/3600:.1f}h"
        else:
            return f"{seconds/86400:.1f}d"
    
    def _calculate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        """Calculate cost in USD based on token usage."""
        return (prompt_tokens / 1_000_000 * INPUT_PRICE_PER_MILLION) + \
               (completion_tokens / 1_000_000 * OUTPUT_PRICE_PER_MILLION)
    
    def _create_analysis_prompt(self, sentences: list[dict]) -> str:
        """Create the prompt for analyzing sentences."""
        sentences_text = "\n".join(f"{i+1}. {s['text']}" for i, s in enumerate(sentences))
        
        return f"""Analyze the following English sentences for language learning purposes.

Your behavior:
- Be EXTREMELY sensitive and conservative.
- When in doubt, ADD flags and LOWER usefulness.
- It is better to over-flag than to miss something problematic.
- Treat anything even mildly rude, dark, sensitive, political, or controversial as flagged.

For each sentence, provide:
1. usefulness: A score from 1–10 for language learners (1 = not useful, 10 = very useful for learning common patterns/vocabulary).
2. flags: Any problematic content flags. Use these categories if applicable:
   - "sexist": Contains sexist content or stereotypes about gender.
   - "racist": Contains racist content, ethnic/religious stereotypes, or slurs.
   - "homophobic": Contains homophobic content or slurs.
   - "violent": Contains violence, threats, killing, self-harm, injury, or physical harm (even hypothetical or joking).
   - "offensive": Contains insults, rudeness, disrespect, profanity, or vulgar expressions.
   - "inappropriate": Contains adult, sexual, or otherwise inappropriate content.
   - "nonsensical": The sentence doesn't make sense or is meaningless in context.
   - "very rare words": The sentence contains very rare or highly technical words that are unlikely to appear in everyday conversation.
   - "triggering": The sentence is likely to trigger trauma, mental illness, or strong distress (e.g., abuse, death of loved ones, extreme suffering).
   - "weird": The sentence is strange, surreal, or has odd wording/formatting (including bizarre combinations like "cup of liver").
   - "political": The sentence is political, mentions countries' status, conflicts, ideologies, public policy, or collective identities. Anything even remotely political should be flagged.
   - "audio-incompatible": The sentence is incompatible with being read aloud (e.g., relies on formatting, symbols, or layout that only makes sense in writing).
   - "hard to pronounce": The sentence is likely hard to pronounce for TTS models, e.g., many foreign names, letter sequences, or tongue-twisters.

If no issues at all, use an empty list for flags. However, you should FLAG MOST SENTENCES unless you are absolutely sure they are harmless.

Additional strict guidance:
- Any mention of death, killing, hurting, weapons, brutality, or crime → include "violent" (and possibly "triggering", "overly negative", or "offensive").
- Any insult, belittling, or strong negativity toward a person or group → include "offensive".
- Any content about national identity, borders, conflicts, history between countries or peoples, or collective groups (e.g., "Palestinians", "Algerians", "Americans", "women", "men") → almost always include "political" and possibly "racist"/"sexist" if framed negatively.
- Any sexual, adult, or body-related content in a non-medical, non-neutral way → include "inappropriate".
- If you are unsure which flag to use, choose the closest one and still add it. Do NOT leave flags empty in borderline cases.
- When flags are present, prefer LOWER usefulness scores, especially if the sentence is disturbing, niche, political, or unlikely to be needed in normal daily conversation.

Sentences to analyze:
{sentences_text}

Return results in the same order as the input sentences."""
    
    def _analyze_batch(self, sentences: list[dict]) -> tuple[list[SentenceAnalysis], str, dict]:
        """Analyze a batch of sentences using the API with fallback models and Pydantic structured outputs."""
        prompt = self._create_analysis_prompt(sentences)
        
        for model in MODELS:
            try:
                # Use Pydantic for structured outputs
                completion = self.classification_client.beta.chat.completions.parse(
                    model=model,
                    messages=[
                        {"role": "system", "content": "You are a language learning expert assistant. Analyze sentences and provide structured analysis results."},
                        {"role": "user", "content": prompt}
                    ],
                    response_format=BatchAnalysisResponse,
                    temperature=0.3,
                )
                
                # Extract parsed Pydantic model
                parsed_response = completion.choices[0].message.parsed
                if parsed_response is None:
                    raise ValueError("Failed to parse response")
                
                usage_info = {
                    'prompt_tokens': completion.usage.prompt_tokens,
                    'completion_tokens': completion.usage.completion_tokens,
                }
                
                return parsed_response.results, model, usage_info
                
            except Exception as e:
                print(f"  ⚠ Error with {model}: {e}")
                continue
        
        print(f"  ✗ All models failed!")
        return [], "", {'prompt_tokens': 0, 'completion_tokens': 0}
    
    def _moderate_batch(self, texts: list[str]) -> list[bool]:
        """Check a batch of texts using OpenAI moderation API. Returns list of booleans: True if flagged."""
        if not self.moderation_client:
            return [False] * len(texts)
        
        try:
            response = self.moderation_client.moderations.create(input=texts)
            return [result.flagged for result in response.results]
        except Exception as e:
            print(f"  ⚠ Moderation API error: {e}")
            return [False] * len(texts)
    
    def _log_cost(self, cost_file: Path, sentences_processed: int, sentences_saved: int,
                  sentences_failed: int, prompt_tokens: int, completion_tokens: int,
                  total_cost: float, duration_seconds: float):
        """Append cost data to CSV file."""
        file_exists = cost_file.exists()
        
        with open(cost_file, 'a', encoding='utf-8', newline='') as f:
            fieldnames = ['timestamp', 'sentences_processed', 'sentences_saved', 'sentences_failed',
                         'prompt_tokens', 'completion_tokens', 'total_tokens', 'cost_usd',
                         'duration_seconds', 'cost_per_1k_sentences']
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            
            if not file_exists:
                writer.writeheader()
            
            cost_per_1k = (total_cost / sentences_saved * 1000) if sentences_saved > 0 else 0
            writer.writerow({
                'timestamp': datetime.now().isoformat(),
                'sentences_processed': sentences_processed,
                'sentences_saved': sentences_saved,
                'sentences_failed': sentences_failed,
                'prompt_tokens': prompt_tokens,
                'completion_tokens': completion_tokens,
                'total_tokens': prompt_tokens + completion_tokens,
                'cost_usd': round(total_cost, 6),
                'duration_seconds': round(duration_seconds, 1),
                'cost_per_1k_sentences': round(cost_per_1k, 6),
            })
    
    def _process_classification_results(self, results: list[SentenceAnalysis], batch: list[dict],
                                       writer: csv.DictWriter, f) -> tuple[int, int, int]:
        """Process classification results and write to file. Returns (saved, failed, low_use, flagged)."""
        low_use = flagged = 0
        
        # Pydantic validation guarantees all results are valid
        for sentence, analysis in zip(batch, results):
            # Check for low usefulness
            if analysis.usefulness <= LOW_USEFULNESS_THRESHOLD:
                low_use += 1
                print(f"  ⚠ LOW USEFULNESS ({analysis.usefulness}): {sentence['text'][:60]}...")
            
            # Check for problematic flags
            if analysis.flags and any(f in PROBLEMATIC_FLAGS for f in analysis.flags):
                flagged += 1
                print(f"  🚩 FLAGGED {analysis.flags}: {sentence['text'][:60]}...")
            
            writer.writerow({
                'id': sentence['id'],
                'text': sentence['text'],
                'usefulness': analysis.usefulness,
                'flags': json.dumps(analysis.flags),
            })
            f.flush()
        
        saved = len(results)
        failed = len(batch) - len(results)
        return saved, failed, low_use, flagged
    
    def classify(self, input_file: Path = None, output_file: Path = None,
                 data_dir: str = None, max_sentences: int = None):
        """Standalone classification. Automatically resumes from where it left off."""
        start_time = time.time()
        paths = self._resolve_paths(data_dir, input_file=input_file, output_file=output_file)
        input_file, output_file = paths['input_file'], paths['output_file']
        
        output_file.parent.mkdir(parents=True, exist_ok=True)
        if not input_file.exists():
            raise FileNotFoundError(f"Input file not found: {input_file}")
        
        processed_ids = self._load_processed_ids(output_file)
        print(f"Already processed: {len(processed_ids):,} sentences")
        print(f"Models (with fallback): {', '.join(m.split('/')[-1].split(':')[0] for m in MODELS)}")
        
        # Load unprocessed sentences
        sentences = []
        total_in_file = 0
        with open(input_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter='\t')
            for row in reader:
                total_in_file += 1
                if row['id'] not in processed_ids:
                    sentences.append(row)
        
        print(f"Total in dataset: {total_in_file:,} sentences")
        print(f"Remaining to process: {len(sentences):,} sentences")
        
        random.shuffle(sentences)
        if max_sentences:
            sentences = sentences[:max_sentences]
            print(f"Will process: {len(sentences):,} random sentences")
        
        if not sentences:
            print("Nothing to process!")
            return
        
        # Process batches
        file_exists = output_file.exists()
        stats = {'saved': 0, 'failed': 0, 'low_use': 0, 'flagged': 0,
                'prompt_tokens': 0, 'completion_tokens': 0}
        request_times = []
        
        with open(output_file, 'a', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['id', 'text', 'usefulness', 'flags'], delimiter='\t')
            if not file_exists:
                writer.writeheader()
            
            total_batches = (len(sentences) + BATCH_SIZE - 1) // BATCH_SIZE
            
            for i in range(0, len(sentences), BATCH_SIZE):
                batch = sentences[i:i + BATCH_SIZE]
                batch_num = i // BATCH_SIZE + 1
                
                batch_start = time.time()
                results, model_used, usage_info = self._analyze_batch(batch)
                batch_time = time.time() - batch_start
                
                stats['prompt_tokens'] += usage_info['prompt_tokens']
                stats['completion_tokens'] += usage_info['completion_tokens']
                request_times.append(batch_time)
                
                batch_cost = self._calculate_cost(usage_info['prompt_tokens'], usage_info['completion_tokens'])
                total_cost = self._calculate_cost(stats['prompt_tokens'], stats['completion_tokens'])
                
                avg_time = sum(request_times) / len(request_times)
                remaining = (len(sentences) - (i + len(batch))) // BATCH_SIZE
                eta = remaining * (avg_time + DELAY_BETWEEN_REQUESTS)
                
                model_short = model_used.split("/")[-1].split(":")[0] if model_used else "FAILED"
                print(f"\nBatch {batch_num}/{total_batches} | {model_short} | {batch_time:.1f}s | "
                     f"${batch_cost:.4f} (total: ${total_cost:.4f}) | ETA: {self._format_time(eta)}")
                
                if results:
                    saved, failed, low_use, flagged = self._process_classification_results(
                        results, batch, writer, f)
                    stats['saved'] += saved
                    stats['failed'] += failed
                    stats['low_use'] += low_use
                    stats['flagged'] += flagged
                else:
                    stats['failed'] += len(batch)
                
                if i + BATCH_SIZE < len(sentences):
                    time.sleep(DELAY_BETWEEN_REQUESTS)
        
        # Final summary
        duration = time.time() - start_time
        final_cost = self._calculate_cost(stats['prompt_tokens'], stats['completion_tokens'])
        
        cost_log_file = output_file.parent / "cost_log.csv"
        self._log_cost(cost_log_file, len(sentences), stats['saved'], stats['failed'],
                      stats['prompt_tokens'], stats['completion_tokens'], final_cost, duration)
        
        print(f"\n{'='*60}")
        print(f"Done! Processed {len(sentences):,} sentences in {self._format_time(duration)}")
        print(f"Successfully classified: {stats['saved']:,} | Failed: {stats['failed']:,}")
        print(f"Low usefulness: {stats['low_use']} | Flagged: {stats['flagged']}")
        print(f"Total cost: ${final_cost:.4f} | Output: {output_file}")
    
    def moderate_and_classify(self, input_file: Path = None, moderated_output_file: Path = None,
                             classified_output_file: Path = None, filtered_output_file: Path = None,
                             data_dir: str = None, max_classify: int = None):
        """Combined moderation and classification pipeline."""
        start_time = time.time()
        paths = self._resolve_paths(data_dir, input_file=input_file,
                                   moderated_output_file=moderated_output_file,
                                   classified_output_file=classified_output_file,
                                   filtered_output_file=filtered_output_file)
        input_file = paths['input_file']
        moderated_output_file = paths['moderated_output_file']
        classified_output_file = paths['classified_output_file']
        filtered_output_file = paths['filtered_output_file']
        
        for p in [moderated_output_file, classified_output_file, filtered_output_file]:
            p.parent.mkdir(parents=True, exist_ok=True)
        
        if not input_file.exists():
            raise FileNotFoundError(f"Input file not found: {input_file}")
        
        if not self.moderation_client:
            raise ValueError("OPENAI_API_KEY not found. Moderation required.")
        
        print("=" * 60)
        print("COMBINED MODERATION & CLASSIFICATION PIPELINE")
        print("=" * 60)
        print(f"Input: {input_file}")
        print(f"Max classify: {max_classify:,}" if max_classify else "Max classify: all")
        print()
        
        # Load processed IDs
        moderated_ids = self._load_processed_ids(moderated_output_file)
        classified_ids = self._load_processed_ids(classified_output_file)
        print(f"Already moderated: {len(moderated_ids):,} | Already classified: {len(classified_ids):,}")
        
        # Load sentences to moderate
        all_sentences = []
        with open(input_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter='\t')
            for row in reader:
                if row['id'] not in moderated_ids:
                    all_sentences.append(row)
        
        print(f"Sentences to moderate: {len(all_sentences):,}")
        random.shuffle(all_sentences)
        
        # Open output files
        mod_file_exists = moderated_output_file.exists()
        class_file_exists = classified_output_file.exists()
        filtered_file_exists = filtered_output_file.exists()
        
        f_moderated = open(moderated_output_file, 'a', encoding='utf-8', newline='')
        f_classified = open(classified_output_file, 'a', encoding='utf-8', newline='')
        f_filtered = open(filtered_output_file, 'a', encoding='utf-8', newline='')
        
        mod_writer = csv.DictWriter(f_moderated, fieldnames=['id', 'language', 'text'], delimiter='\t')
        class_writer = csv.DictWriter(f_classified, fieldnames=['id', 'text', 'usefulness', 'flags'], delimiter='\t')
        filtered_writer = csv.DictWriter(f_filtered, fieldnames=['id', 'text', 'filter_reason'], delimiter='\t')
        
        for writer, exists in [(mod_writer, mod_file_exists), (class_writer, class_file_exists),
                               (filtered_writer, filtered_file_exists)]:
            if not exists:
                writer.writeheader()
        
        # Stats
        stats = {'moderated': 0, 'filtered': 0, 'classified': 0, 'failed': 0,
                'low_use': 0, 'flagged': 0, 'prompt_tokens': 0, 'completion_tokens': 0}
        classification_times = []
        classification_queue = []
        
        print("\nProcessing sentences...")
        print("-" * 60)
        total_batches = (len(all_sentences) + MODERATION_BATCH_SIZE - 1) // MODERATION_BATCH_SIZE
        
        for i in range(0, len(all_sentences), MODERATION_BATCH_SIZE):
            batch_num = i // MODERATION_BATCH_SIZE + 1
            batch = all_sentences[i:i + MODERATION_BATCH_SIZE]
            batch_texts = [row['text'] for row in batch]
            
            # Moderate batch
            print(f"\n[Batch {batch_num}/{total_batches}] Moderating {len(batch)} sentences...")
            flagged_results = self._moderate_batch(batch_texts)
            
            for row, is_flagged in zip(batch, flagged_results):
                if is_flagged:
                    stats['filtered'] += 1
                    text_preview = row['text'][:80] + "..." if len(row['text']) > 80 else row['text']
                    print(f"    ✗ FILTERED (moderation): {text_preview}")
                    filtered_writer.writerow({'id': row['id'], 'text': row['text'], 'filter_reason': 'moderation'})
                    f_filtered.flush()
                else:
                    mod_writer.writerow(row)
                    moderated_ids.add(row['id'])
                    stats['moderated'] += 1
                    f_moderated.flush()
                    
                    if row['id'] not in classified_ids:
                        classification_queue.append(row)
            
            print(f"  Moderation: {stats['moderated']} passed, {stats['filtered']} filtered")
            
            # Classify from queue
            if max_classify and stats['classified'] >= max_classify:
                print(f"  ✓ Reached max classification limit ({max_classify:,})")
                break
            
            while len(classification_queue) >= BATCH_SIZE:
                classify_batch = classification_queue[:BATCH_SIZE]
                classification_queue = classification_queue[BATCH_SIZE:]
                
                if max_classify and stats['classified'] + len(classify_batch) > max_classify:
                    classify_batch = classify_batch[:max_classify - stats['classified']]
                
                print(f"  Classifying {len(classify_batch)} sentences...", end=" ")
                classify_start = time.time()
                
                results, model_used, usage_info = self._analyze_batch(classify_batch)
                
                stats['prompt_tokens'] += usage_info['prompt_tokens']
                stats['completion_tokens'] += usage_info['completion_tokens']
                
                batch_cost = self._calculate_cost(usage_info['prompt_tokens'], usage_info['completion_tokens'])
                
                classify_time = time.time() - classify_start
                classification_times.append(classify_time)
                
                remaining = (max_classify - stats['classified']) if max_classify else len(classification_queue)
                remaining_batches = (remaining + BATCH_SIZE - 1) // BATCH_SIZE
                avg_time = sum(classification_times) / len(classification_times) if classification_times else 0
                eta = remaining_batches * (avg_time + DELAY_BETWEEN_REQUESTS)
                
                if results:
                    saved, failed, low_use, flagged = self._process_classification_results(
                        results, classify_batch, class_writer, f_classified)
                    stats['classified'] += saved
                    stats['failed'] += failed
                    stats['low_use'] += low_use
                    stats['flagged'] += flagged
                else:
                    stats['failed'] += len(classify_batch)
                
                model_short = model_used.split("/")[-1].split(":")[0] if model_used else "FAILED"
                print(f"{model_short} | {classify_time:.1f}s | ${batch_cost:.4f} | "
                     f"Classified: {stats['classified']:,}", end="")
                if remaining_batches > 0:
                    print(f" | ETA: {self._format_time(eta)}")
                else:
                    print()
                
                if max_classify and stats['classified'] >= max_classify:
                    break
                
                time.sleep(DELAY_BETWEEN_REQUESTS)
            
            if i + MODERATION_BATCH_SIZE < len(all_sentences):
                time.sleep(MODERATION_DELAY)
        
        # Process remaining queue
        print("\n" + "=" * 60)
        print("Processing remaining sentences...")
        while classification_queue and (not max_classify or stats['classified'] < max_classify):
            if max_classify:
                classify_batch = classification_queue[:min(BATCH_SIZE, max_classify - stats['classified'])]
            else:
                classify_batch = classification_queue[:BATCH_SIZE]
            
            classification_queue = classification_queue[len(classify_batch):]
            
            if not classify_batch:
                break
            
            print(f"Classifying final batch of {len(classify_batch)} sentences...", end=" ")
            classify_start = time.time()
            
            results, model_used, usage_info = self._analyze_batch(classify_batch)
            
            stats['prompt_tokens'] += usage_info['prompt_tokens']
            stats['completion_tokens'] += usage_info['completion_tokens']
            
            batch_cost = (usage_info['prompt_tokens'] / 1_000_000 * INPUT_PRICE_PER_MILLION) + \
                        (usage_info['completion_tokens'] / 1_000_000 * OUTPUT_PRICE_PER_MILLION)
            
            classify_time = time.time() - classify_start
            
            if results:
                saved, failed, low_use, flagged = self._process_classification_results(
                    results, classify_batch, class_writer, f_classified)
                stats['classified'] += saved
                stats['failed'] += failed
                stats['low_use'] += low_use
                stats['flagged'] += flagged
            else:
                stats['failed'] += len(classify_batch)
            
            model_short = model_used.split("/")[-1].split(":")[0] if model_used else "FAILED"
            print(f"{model_short} | {classify_time:.1f}s | ${batch_cost:.4f} | "
                 f"Total classified: {stats['classified']:,}")
            
            if max_classify and stats['classified'] >= max_classify:
                break
            
            time.sleep(DELAY_BETWEEN_REQUESTS)
        
        # Close files
        f_moderated.close()
        f_classified.close()
        f_filtered.close()
        
        # Final summary
        duration = time.time() - start_time
        final_cost = self._calculate_cost(stats['prompt_tokens'], stats['completion_tokens'])
        
        cost_log_file = classified_output_file.parent / "cost_log.csv"
        self._log_cost(cost_log_file, stats['moderated'], stats['classified'], stats['failed'],
                      stats['prompt_tokens'], stats['completion_tokens'], final_cost, duration)
        
        print()
        print("=" * 60)
        print("PIPELINE SUMMARY")
        print("=" * 60)
        print(f"Runtime: {self._format_time(duration)}")
        print(f"MODERATION: Processed {len(all_sentences):,} | Passed {stats['moderated']:,} | Filtered {stats['filtered']:,}")
        print(f"CLASSIFICATION: Classified {stats['classified']:,} | Failed {stats['failed']:,} | "
             f"Low use {stats['low_use']:,} | Flagged {stats['flagged']:,}")
        print(f"COSTS: ${final_cost:.4f} ({stats['prompt_tokens']:,} + {stats['completion_tokens']:,} tokens)")
        print(f"Outputs: {moderated_output_file.name}, {classified_output_file.name}, {filtered_output_file.name}")


# Backward compatibility functions
def classify_sentences(input_file: Path = None, output_file: Path = None,
                      data_dir: str = None, max_sentences: int = None):
    """Standalone classification (backward compatibility)."""
    processor = SentenceProcessor()
    processor.classify(input_file, output_file, data_dir, max_sentences)


def moderate_and_classify_sentences(input_file: Path = None, moderated_output_file: Path = None,
                                    classified_output_file: Path = None,
                                    filtered_output_file: Path = None,
                                    data_dir: str = None, max_classify: int = None):
    """Combined moderation and classification (backward compatibility)."""
    processor = SentenceProcessor()
    processor.moderate_and_classify(input_file, moderated_output_file, classified_output_file,
                                   filtered_output_file, data_dir, max_classify)

