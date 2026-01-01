#!/usr/bin/env python3
"""
Filter sentences based on length, banned words, and OpenAI moderation.
Removes sentences that are too long, contain inappropriate content, or are flagged by moderation API.
Each filtering step can be run individually.
"""

import csv
import os
import random
import re
import shutil
import time
from multiprocessing import Pool, cpu_count
from pathlib import Path
from openai import OpenAI

try:
    from dotenv import load_dotenv
    script_dir = Path(__file__).parent
    env_file = script_dir.parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

try:
    from better_profanity import profanity
    PROFANITY_AVAILABLE = True
except ImportError:
    PROFANITY_AVAILABLE = False
    print("⚠ Warning: better_profanity not installed. Profanity filtering will be skipped.")
    print("  Install with: pip install better-profanity")

# Import constants from config
try:
    from .config import (
        MAX_WORDS,
        BANNED_WORDS,
        MODERATION_BATCH_SIZE,
        MODERATION_DELAY,
        PARALLEL_BATCH_SIZE,
        PROGRESS_UPDATE_INTERVAL,
    )
except ImportError:
    # Fallback for direct execution
    from config import (
        MAX_WORDS,
        BANNED_WORDS,
        MODERATION_BATCH_SIZE,
        MODERATION_DELAY,
        PARALLEL_BATCH_SIZE,
        PROGRESS_UPDATE_INTERVAL,
    )


def format_time(seconds: float) -> str:
    """Format seconds into human readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds/60:.1f}m"
    elif seconds < 86400:
        return f"{seconds/3600:.1f}h"
    else:
        return f"{seconds/86400:.1f}d"


def count_words(text: str) -> int:
    """Count words in a sentence."""
    return len(text.split())


def contains_banned_word(text: str) -> str | None:
    """Check if text contains any banned word. Returns the banned word if found, None otherwise.
    Matching is case-insensitive."""
    text_lower = text.lower()
    for word in BANNED_WORDS:
        # Match whole word only (with word boundaries), case-insensitive
        word_lower = word.lower()
        if re.search(rf'\b{re.escape(word_lower)}\b', text_lower):
            return word
    return None


def get_openai_client() -> OpenAI | None:
    """Get OpenAI client for moderation API."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(api_key=api_key)


def check_moderation_batch(client: OpenAI, texts: list[str]) -> list[bool]:
    """
    Check a batch of texts using OpenAI moderation API.
    Returns list of booleans: True if flagged, False if safe.
    """
    try:
        response = client.moderations.create(input=texts)
        
        # Extract flagged status for each input
        results = []
        for result in response.results:
            results.append(result.flagged)
        
        return results
    except Exception as e:
        print(f"  ⚠ Moderation API error: {e}")
        # On error, assume all are safe (don't filter them out)
        return [False] * len(texts)


def load_processed_ids(output_file: Path) -> set:
    """Load IDs of already processed sentences from output file."""
    processed = set()
    if output_file.exists():
        with open(output_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter='\t')
            for row in reader:
                processed.add(row['id'])
    return processed


def _process_sentence_batch(args):
    """
    Process a batch of sentences in parallel.
    Returns tuple: (kept_sentences, filtered_sentences, stats)
    """
    batch, processed_ids_set = args
    
    # Initialize profanity in this worker
    prof = None
    if PROFANITY_AVAILABLE:
        try:
            from better_profanity import profanity as prof
            prof.load_censor_words()
        except:
            prof = None
    
    kept = []
    filtered = []
    stats = {
        'total': len(batch),
        'skipped': 0,
        'kept': 0,
        'filtered_too_long': 0,
        'filtered_banned': 0,
        'filtered_profanity': 0,
        'filtered_non_english': 0,
        'banned_word_counts': {}
    }
    
    for row in batch:
        sentence_id = row['id']
        text = row['text']
        language = row.get('language', 'eng')  # Default to 'eng' if missing
        is_already_processed = sentence_id in processed_ids_set
        
        # Skip non-English sentences
        if language != 'eng':
            stats['filtered_non_english'] += 1
            filtered.append({
                'id': sentence_id,
                'text': text,
                'filter_reason': f'non_english_{language}'
            })
            continue
        
        # Check banned words for ALL sentences (even already processed ones)
        banned = contains_banned_word(text)
        if banned:
            stats['filtered_banned'] += 1
            if banned not in stats['banned_word_counts']:
                stats['banned_word_counts'][banned] = 0
            stats['banned_word_counts'][banned] += 1
            filtered.append({
                'id': sentence_id,
                'text': text,
                'filter_reason': f'banned_word_{banned}'
            })
            continue
        
        # For already processed sentences, skip other checks
        if is_already_processed:
            stats['skipped'] += 1
            continue
        
        # For new sentences, check word count
        word_count = count_words(text)
        if word_count > MAX_WORDS:
            stats['filtered_too_long'] += 1
            filtered.append({
                'id': sentence_id,
                'text': text,
                'filter_reason': 'too_long'
            })
            continue
        
        # Check profanity only for new sentences
        if prof and prof.contains_profanity(text):
            stats['filtered_profanity'] += 1
            filtered.append({
                'id': sentence_id,
                'text': text,
                'filter_reason': 'profanity'
            })
            continue
        
        # Keep sentence
        kept.append(row)
        stats['kept'] += 1
    
    return kept, filtered, stats


def filter_by_length_and_banned_words(
    input_file: Path,
    output_file: Path,
    filtered_output_file: Path,
    data_dir: str = None,
    num_workers: int = None,
):
    """
    Filter sentences by length and banned words using parallel processing.
    Creates intermediate file for next step (moderation).
    
    Args:
        input_file: Path to input CSV file
        output_file: Path to output CSV file (sentences that passed)
        filtered_output_file: Path to filtered sentences CSV file
        data_dir: Base data directory (for path resolution)
        num_workers: Number of worker processes (default: CPU count)
    """
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    # Load already processed IDs for resumability
    processed_ids = load_processed_ids(output_file)
    already_processed = len(processed_ids)
    
    # Determine number of workers
    if num_workers is None:
        num_workers = cpu_count()
    
    # Initialize profanity checker
    if PROFANITY_AVAILABLE:
        print(f"Step: Filter by length, banned words, and profanity (parallelized)")
    else:
        print(f"Step: Filter by length and banned words (profanity check unavailable, parallelized)")
    
    print(f"Input: {input_file}")
    print(f"Max words: {MAX_WORDS}")
    print(f"Banned words: {len(BANNED_WORDS)} words")
    print(f"Profanity filter: {'Enabled' if PROFANITY_AVAILABLE else 'Disabled'}")
    print(f"Workers: {num_workers}")
    print(f"Batch size: {PARALLEL_BATCH_SIZE:,} sentences per batch")
    print(f"Already processed: {already_processed:,} sentences")
    print()
    
    # Open output files
    file_exists = output_file.exists()
    filtered_file_exists = filtered_output_file.exists()
    
    fieldnames = ['id', 'language', 'text']
    filtered_fieldnames = ['id', 'text', 'filter_reason']
    
    # Count total lines for progress estimation
    print("  Counting total sentences...")
    with open(input_file, 'r', encoding='utf-8') as f_in:
        total_lines = sum(1 for _ in csv.DictReader(f_in, delimiter='\t'))
    print(f"  Total sentences in file: {total_lines:,}\n")
    
    # Read all sentences into batches (including already processed ones for banned word check)
    print("  Reading sentences into batches...")
    all_sentences = []
    with open(input_file, 'r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in, delimiter='\t')
        for row in reader:
            all_sentences.append(row)
    
    total_to_process = len(all_sentences)
    new_sentences_count = sum(1 for row in all_sentences if row['id'] not in processed_ids)
    print(f"  Total sentences in file: {total_to_process:,}")
    print(f"  New sentences to process: {new_sentences_count:,}")
    print(f"  Already processed: {already_processed:,}\n")
    
    if total_to_process == 0:
        print("No sentences in file!")
        return
    
    # Create batches
    batches = []
    for i in range(0, total_to_process, PARALLEL_BATCH_SIZE):
        batch = all_sentences[i:i + PARALLEL_BATCH_SIZE]
        batches.append((batch, processed_ids))
    
    total_batches = len(batches)
    print(f"  Created {total_batches:,} batches\n")
    
    # Initialize output files
    with open(output_file, 'a' if file_exists else 'w', encoding='utf-8', newline='') as f:
        if not file_exists:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter='\t')
            writer.writeheader()
    
    with open(filtered_output_file, 'a' if filtered_file_exists else 'w', encoding='utf-8', newline='') as f:
        if not filtered_file_exists:
            writer = csv.DictWriter(f, fieldnames=filtered_fieldnames, delimiter='\t')
            writer.writeheader()
    
    # Stats
    total_processed = 0
    skipped_already_processed = already_processed
    kept = 0
    filtered_too_long = 0
    filtered_banned = 0
    filtered_profanity = 0
    filtered_non_english = 0
    banned_word_counts = {word: 0 for word in BANNED_WORDS}
    
    start_time = time.time()
    
    # Process batches in parallel
    print("  Processing batches in parallel...")
    with Pool(processes=num_workers) as pool:
        results = pool.imap(_process_sentence_batch, batches)
        
        for batch_idx, (kept_sentences, filtered_sentences, stats) in enumerate(results):
            batch_num = batch_idx + 1
            
            # Update stats
            total_processed += stats['total']
            skipped_already_processed += stats['skipped']
            kept += stats['kept']
            filtered_too_long += stats['filtered_too_long']
            filtered_banned += stats['filtered_banned']
            filtered_profanity += stats['filtered_profanity']
            filtered_non_english += stats['filtered_non_english']
            
            # Merge banned word counts
            for word, count in stats['banned_word_counts'].items():
                if word not in banned_word_counts:
                    banned_word_counts[word] = 0
                banned_word_counts[word] += count
            
            # Write results to files
            with open(output_file, 'a', encoding='utf-8', newline='') as f_out:
                writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter='\t')
                for row in kept_sentences:
                    writer.writerow(row)
                    processed_ids.add(row['id'])
            
            with open(filtered_output_file, 'a', encoding='utf-8', newline='') as f_filtered:
                filtered_writer = csv.DictWriter(f_filtered, fieldnames=filtered_fieldnames, delimiter='\t')
                for filtered_row in filtered_sentences:
                    filtered_writer.writerow(filtered_row)
            
            # Progress update
            if batch_num % max(1, total_batches // 100) == 0 or batch_num == total_batches:
                elapsed = time.time() - start_time
                rate = total_processed / elapsed if elapsed > 0 else 0
                remaining = (total_to_process - total_processed) / rate if rate > 0 else 0
                pct = 100 * total_processed / total_to_process if total_to_process > 0 else 0
                filtered_total = filtered_too_long + filtered_banned + filtered_profanity + filtered_non_english
                print(f"  [{pct:5.1f}%] Batch {batch_num:,}/{total_batches:,} | "
                      f"Processed: {total_processed:,} | "
                      f"Kept: {kept:,} | "
                      f"Filtered: {filtered_total:,} | "
                      f"ETA: {format_time(remaining)}")
    
    elapsed_time = time.time() - start_time
    
    # Summary
    print()
    print("=" * 60)
    print("FILTER BY LENGTH AND BANNED WORDS - SUMMARY")
    print("=" * 60)
    newly_processed = new_sentences_count
    print(f"Total sentences:         {total_lines:,}")
    print(f"Already processed:       {already_processed:,}")
    print(f"Newly processed:         {newly_processed:,}")
    if newly_processed > 0:
        print(f"Kept (new):              {kept:,} ({100*kept/newly_processed:.1f}% of newly processed)")
    else:
        print(f"Kept (new):              {kept:,}")
    print(f"Filtered (non-English):   {filtered_non_english:,} (all sentences checked)")
    print(f"Filtered (too long):      {filtered_too_long:,} (new sentences only)")
    print(f"Filtered (banned words): {filtered_banned:,} (all sentences checked)")
    if PROFANITY_AVAILABLE:
        print(f"Filtered (profanity):    {filtered_profanity:,} (new sentences only)")
    print()
    print("Banned word breakdown:")
    for word, count in sorted(banned_word_counts.items(), key=lambda x: -x[1]):
        if count > 0:
            print(f"  {word}: {count:,}")
    print()
    print(f"Time taken: {format_time(elapsed_time)}")
    print(f"Output (kept): {output_file}")
    print(f"Output (filtered): {filtered_output_file}")


def filter_by_moderation(
    input_file: Path,
    output_file: Path,
    filtered_output_file: Path,
    data_dir: str = None,
):
    """
    Filter sentences using OpenAI moderation API.
    
    Args:
        input_file: Path to input CSV file (from previous filtering step)
        output_file: Path to output CSV file (sentences that passed)
        filtered_output_file: Path to filtered sentences CSV file
        data_dir: Base data directory (for path resolution)
    """
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    # Initialize OpenAI client
    moderation_client = get_openai_client()
    if not moderation_client:
        print("⚠ Warning: OPENAI_API_KEY not found. Moderation checks cannot be performed.")
        return
    
    # Load already processed IDs for resumability
    processed_ids = load_processed_ids(output_file)
    already_processed = len(processed_ids)
    
    print(f"Step: Filter by OpenAI moderation")
    print(f"Input: {input_file}")
    print(f"Batch size: {MODERATION_BATCH_SIZE}")
    print(f"Already processed: {already_processed:,} sentences")
    print()
    
    # Open output files
    file_exists = output_file.exists()
    filtered_file_exists = filtered_output_file.exists()
    
    f_out = open(output_file, 'a' if file_exists else 'w', encoding='utf-8', newline='')
    f_filtered = open(filtered_output_file, 'a' if filtered_file_exists else 'w', encoding='utf-8', newline='')
    
    fieldnames = ['id', 'language', 'text']
    filtered_fieldnames = ['id', 'text', 'filter_reason']
    
    writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter='\t')
    filtered_writer = csv.DictWriter(f_filtered, fieldnames=filtered_fieldnames, delimiter='\t')
    
    if not file_exists:
        writer.writeheader()
    if not filtered_file_exists:
        filtered_writer.writeheader()
    
    f_out.flush()
    f_filtered.flush()
    
    # Stats
    total = 0
    skipped_already_processed = 0
    kept = 0
    filtered_moderation = 0
    
    # Count total lines for progress estimation
    print("  Counting total sentences...")
    with open(input_file, 'r', encoding='utf-8') as f_in:
        total_lines = sum(1 for _ in csv.DictReader(f_in, delimiter='\t'))
    print(f"  Total sentences in file: {total_lines:,}\n")
    
    # Read all candidates
    candidates = []
    with open(input_file, 'r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in, delimiter='\t')
        for row in reader:
            total += 1
            if row['id'] not in processed_ids:
                candidates.append((row, row['text']))
            else:
                skipped_already_processed += 1
    
    if not candidates:
        print("No new sentences to process!")
        f_out.close()
        f_filtered.close()
        return
    
    print(f"Processing {len(candidates):,} sentences...")
    start_time = time.time()
    
    total_batches = (len(candidates) + MODERATION_BATCH_SIZE - 1) // MODERATION_BATCH_SIZE
    batch_times = []
    
    for i in range(0, len(candidates), MODERATION_BATCH_SIZE):
        batch_start = time.time()
        batch_num = i // MODERATION_BATCH_SIZE + 1
        batch = candidates[i:i + MODERATION_BATCH_SIZE]
        batch_texts = [text for _, text in batch]
        
        # Check moderation
        flagged_results = check_moderation_batch(moderation_client, batch_texts)
        
        # Write safe sentences immediately and filter flagged ones
        for (row, text), is_flagged in zip(batch, flagged_results):
            sentence_id = row['id']
            
            if is_flagged:
                filtered_moderation += 1
                text_preview = text[:80] + "..." if len(text) > 80 else text
                print(f"  ✗ FILTERED (moderation): {text_preview}")
                # Save to filtered file
                filtered_writer.writerow({
                    'id': sentence_id,
                    'text': text,
                    'filter_reason': 'moderation'
                })
                f_filtered.flush()
            else:
                writer.writerow(row)
                kept += 1
                processed_ids.add(sentence_id)
        
        # Flush after each batch to ensure data is saved
        f_out.flush()
        
        batch_time = time.time() - batch_start
        batch_times.append(batch_time)
        
        # Calculate progress and ETA
        avg_batch_time = sum(batch_times) / len(batch_times) if batch_times else 0
        remaining_batches = total_batches - batch_num
        eta_remaining = remaining_batches * (avg_batch_time + MODERATION_DELAY)
        
        # Progress output
        pct = 100 * batch_num / total_batches if total_batches > 0 else 0
        print(f"  [{pct:5.1f}%] Batch {batch_num:,}/{total_batches:,} | "
              f"{batch_time:.2f}s | "
              f"Filtered: {filtered_moderation:,} | "
              f"Kept: {kept:,} | "
              f"ETA: {format_time(eta_remaining)}")
        
        # Rate limiting
        if i + MODERATION_BATCH_SIZE < len(candidates):
            time.sleep(MODERATION_DELAY)
    
    elapsed_time = time.time() - start_time
    
    # Close files
    f_out.close()
    f_filtered.close()
    
    # Summary
    print()
    print("=" * 60)
    print("FILTER BY MODERATION - SUMMARY")
    print("=" * 60)
    newly_processed = len(candidates)
    print(f"Total sentences:         {total:,}")
    print(f"Already processed:       {already_processed:,}")
    print(f"Skipped (already done):  {skipped_already_processed:,}")
    print(f"Newly processed:         {newly_processed:,}")
    if newly_processed > 0:
        print(f"Kept:                    {kept:,} ({100*kept/newly_processed:.1f}% of newly processed)")
    else:
        print(f"Kept:                    {kept:,}")
    print(f"Filtered (moderation):    {filtered_moderation:,}")
    print()
    print(f"Time taken: {format_time(elapsed_time)}")
    print(f"Output (kept): {output_file}")
    print(f"Output (filtered): {filtered_output_file}")


def remove_filtered_sentences(
    input_file: Path,
    filtered_out_file: Path,
    output_file: Path,
    data_dir: str = None,
):
    """
    Remove sentences from input_file that were filtered out (for banned words).
    Updates the intermediate file to exclude filtered sentences.
    
    Args:
        input_file: Path to the file to clean (e.g., filtered_length_banned.csv)
        filtered_out_file: Path to filtered_out_sentences.csv with filter reasons
        output_file: Path to output cleaned file (can be same as input_file to overwrite)
        data_dir: Base data directory (for path resolution)
    """
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    if not filtered_out_file.exists():
        print(f"⚠ Warning: Filtered out file not found: {filtered_out_file}")
        print("  No sentences to remove. Copying input to output.")
        shutil.copy2(input_file, output_file)
        return
    
    print(f"Step: Remove filtered sentences from intermediate file")
    print(f"Input: {input_file}")
    print(f"Filtered out file: {filtered_out_file}")
    print(f"Output: {output_file}")
    print()
    
    # Load IDs of sentences filtered for banned words
    print("  Loading filtered sentence IDs...")
    filtered_ids = set()
    with open(filtered_out_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            filter_reason = row.get('filter_reason', '')
            # Only remove sentences filtered for banned words
            if filter_reason.startswith('banned_word_'):
                filtered_ids.add(row['id'])
    
    print(f"  Found {len(filtered_ids):,} sentences filtered for banned words")
    
    if not filtered_ids:
        print("  No banned word sentences to remove. Copying input to output.")
        shutil.copy2(input_file, output_file)
        return
    
    # Read input file and filter out banned sentences
    print("  Reading input file...")
    kept_sentences = []
    removed_count = 0
    total_count = 0
    
    with open(input_file, 'r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in, delimiter='\t')
        fieldnames = reader.fieldnames
        
        for row in reader:
            total_count += 1
            if row['id'] not in filtered_ids:
                kept_sentences.append(row)
            else:
                removed_count += 1
    
    print(f"  Total sentences: {total_count:,}")
    print(f"  Removed: {removed_count:,}")
    print(f"  Kept: {len(kept_sentences):,}")
    
    # Write cleaned file
    print("  Writing cleaned file...")
    with open(output_file, 'w', encoding='utf-8', newline='') as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter='\t')
        writer.writeheader()
        for row in kept_sentences:
            writer.writerow(row)
    
    # Summary
    print()
    print("=" * 60)
    print("REMOVE FILTERED SENTENCES - SUMMARY")
    print("=" * 60)
    print(f"Total sentences:    {total_count:,}")
    print(f"Removed:            {removed_count:,} ({100*removed_count/total_count:.1f}%)")
    print(f"Kept:               {len(kept_sentences):,} ({100*len(kept_sentences)/total_count:.1f}%)")
    print()
    print(f"Output: {output_file}")


def filter_by_name_limits(
    input_file: Path,
    output_file: Path,
    filtered_output_file: Path,
    limited_names: list[str],
    name_limit_percent: float,
    target_size: int = None,
    data_dir: str = None,
    seed: int = None,
):
    """
    Filter sentences by limiting occurrences of specific names.
    This should be run BEFORE random sampling.
    
    Args:
        input_file: Path to input CSV file
        output_file: Path to output CSV file with filtered sentences
        filtered_output_file: Path to output CSV file for filtered-out sentences
        limited_names: List of names to limit (e.g., ["Tom", "Mary", "John"])
        name_limit_percent: Percentage limit for each name (e.g., 0.6 means 0.6% of target_size)
        target_size: Target size for calculating name limits. If None, uses total input size.
        data_dir: Base data directory (for path resolution)
        seed: Random seed for reproducibility (optional)
    """
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    if seed is not None:
        random.seed(seed)
    
    if not limited_names:
        raise ValueError("limited_names cannot be empty")
    
    # Create mapping from lowercase to original name for display
    name_mapping = {name.lower(): name for name in limited_names}
    limited_names_lower = list(name_mapping.keys())
    
    print(f"Step: Filter by name limits")
    print(f"Input: {input_file}")
    print(f"Output: {output_file}")
    print(f"Filtered out: {filtered_output_file}")
    print(f"Limited names: {limited_names}")
    print(f"Name limit: {name_limit_percent}% per name")
    if seed is not None:
        print(f"Random seed: {seed}")
    print()
    
    # First pass: count total lines for progress
    with open(input_file, 'r', encoding='utf-8') as f_in:
        total_lines = sum(1 for _ in f_in) - 1  # Subtract header
    
    # Determine target size for limit calculation (use entire dataset if not specified)
    if target_size is None:
        target_size = total_lines
    print(f"  Using dataset size: {target_size:,} (for calculating name limits)")
    
    # Calculate limit for each name
    name_limit = int(target_size * (name_limit_percent / 100))
    print(f"  Name limit per name: {name_limit:,} sentences ({name_limit_percent}% of {target_size:,})")
    print()
    
    # Initialize tracking structures
    sentences_by_name = {name: [] for name in limited_names_lower}
    sentences_without_limited_names = []
    name_counts = {name: 0 for name in limited_names_lower}
    
    # Single pass: Read and categorize sentences immediately
    print("  Reading and categorizing sentences...")
    with open(input_file, 'r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in, delimiter='\t')
        fieldnames = reader.fieldnames
        
        processed = 0
        last_percent = -1
        for row in reader:
            text = row.get('text', '').lower()
            found_any_name = False
            
            # Check which names this sentence contains
            for name_lower in limited_names_lower:
                if re.search(rf'\b{re.escape(name_lower)}\b', text):
                    sentences_by_name[name_lower].append(row)
                    name_counts[name_lower] += 1
                    found_any_name = True
            
            # If no limited names found, keep it instantly (no filtering needed)
            if not found_any_name:
                sentences_without_limited_names.append(row)
            
            processed += 1
            # Show progress every 5%
            percent = int(100 * processed / total_lines) if total_lines > 0 else 0
            if percent != last_percent and percent % 5 == 0:
                print(f"    Progress: {percent}% ({processed:,}/{total_lines:,} sentences)", end='\r')
                last_percent = percent
        
        # Clear progress line
        print(f"    Progress: 100% ({processed:,}/{total_lines:,} sentences)")
    
    total_sentences = processed
    print(f"  Total sentences in file: {total_sentences:,}")
    
    # Display initial counts
    print(f"\n  Initial name counts:")
    for name_lower in limited_names_lower:
        original_name = name_mapping[name_lower]
        count = name_counts[name_lower]
        print(f"    '{original_name}': {count:,} occurrences")
    print(f"    Without limited names: {len(sentences_without_limited_names):,} (kept instantly)")
    
    # Step 2: Filter sentences, processing names from most common to least common
    # This ensures sentences with multiple names don't inflate counts
    print(f"\n  Step 2: Filtering sentences that exceed limits...")
    print(f"  Processing names from most common to least common...")
    
    # Sort names by count (most common first)
    sorted_names = sorted(limited_names_lower, key=lambda n: name_counts[n], reverse=True)
    print(f"  Processing order: {', '.join(name_mapping[n] for n in sorted_names)}")
    
    sentences_to_keep_by_name = {}
    filtered_sentences = []
    filtered_sentence_ids = set()  # Track IDs of sentences filtered for previous names
    total_filtered = 0
    
    # Process each name in order (most common first)
    for name_lower in sorted_names:
        original_name = name_mapping[name_lower]
        
        # Get sentences for this name, excluding those already filtered for previous names
        available_sentences = [
            s for s in sentences_by_name[name_lower]
            if s['id'] not in filtered_sentence_ids
        ]
        
        count = len(available_sentences)
        initial_count = len(sentences_by_name[name_lower])
        already_filtered_count = initial_count - count
        
        if already_filtered_count > 0:
            print(f"    '{original_name}': {already_filtered_count:,} sentences already filtered by previous names")
        
        if count > name_limit:
            # Need to filter - randomly select which ones to keep
            to_keep = random.sample(available_sentences, name_limit)
            sentences_to_keep_by_name[name_lower] = to_keep
            
            # Track filtered sentences (the ones not kept)
            to_keep_ids = {s['id'] for s in to_keep}
            filtered_for_name = [s for s in available_sentences if s['id'] not in to_keep_ids]
            filtered_sentences.extend(filtered_for_name)
            
            # Add filtered sentence IDs to the set so they don't count for future names
            for s in filtered_for_name:
                filtered_sentence_ids.add(s['id'])
            
            filtered_count = count - name_limit
            total_filtered += filtered_count
            print(f"    '{original_name}': Kept {name_limit:,}, filtered {filtered_count:,} (from {count:,} available)")
        else:
            # All available can be kept
            sentences_to_keep_by_name[name_lower] = available_sentences
            print(f"    '{original_name}': Kept all {count:,} (under limit, from {initial_count:,} total)")
    
    # Step 3: Build final filtered dataset
    print(f"\n  Step 3: Building final filtered dataset...")
    
    # Track sentences by ID to handle duplicates (sentences with multiple names)
    seen_ids = set()
    final_sentences = []
    total_with_names = 0
    
    # Add sentences with names (up to limit) - use sorted order for consistency
    for name_lower in sorted_names:
        for row in sentences_to_keep_by_name[name_lower]:
            total_with_names += 1
            if row['id'] not in seen_ids:
                final_sentences.append(row)
                seen_ids.add(row['id'])
    
    # Add all sentences without limited names (already filtered, no duplicates possible)
    final_sentences.extend(sentences_without_limited_names)
    
    duplicates_removed = total_with_names - len(seen_ids)
    if duplicates_removed > 0:
        print(f"  Removed {duplicates_removed:,} duplicate sentences (contained multiple names)")
    
    print(f"  Final dataset size: {len(final_sentences):,}")
    
    # Display final counts
    print(f"\n  Final name counts in filtered dataset:")
    for name_lower in limited_names_lower:
        original_name = name_mapping[name_lower]
        final_count = sum(1 for s in final_sentences if re.search(rf'\b{re.escape(name_lower)}\b', s.get('text', '').lower()))
        print(f"    '{original_name}': {final_count:,} (limit: {name_limit:,})")
    
    # Write filtered sentences to output
    print(f"\n  Writing filtered sentences...")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8', newline='') as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter='\t')
        writer.writeheader()
        
        written = 0
        total_to_write = len(final_sentences)
        last_percent = -1
        for row in final_sentences:
            writer.writerow(row)
            written += 1
            
            # Show progress every 10% or at the end
            percent = int(100 * written / total_to_write) if total_to_write > 0 else 0
            if (percent != last_percent and percent % 10 == 0) or written == total_to_write:
                print(f"    Progress: {percent}% ({written:,}/{total_to_write:,} sentences)", end='\r')
                last_percent = percent
        
        # Clear progress line
        print(f"    Progress: 100% ({written:,}/{total_to_write:,} sentences)")
    
    # Write filtered-out sentences
    print(f"  Writing filtered-out sentences...")
    filtered_output_file.parent.mkdir(parents=True, exist_ok=True)
    filtered_file_exists = filtered_output_file.exists()
    
    # Deduplicate filtered sentences by ID first
    seen_filtered_ids = set()
    unique_filtered = []
    for row in filtered_sentences:
        if row['id'] not in seen_filtered_ids:
            unique_filtered.append(row)
            seen_filtered_ids.add(row['id'])
    
    with open(filtered_output_file, 'a' if filtered_file_exists else 'w', encoding='utf-8', newline='') as f_filtered:
        filtered_writer = csv.DictWriter(f_filtered, fieldnames=['id', 'text', 'filter_reason'], delimiter='\t')
        if not filtered_file_exists:
            filtered_writer.writeheader()
        
        written = 0
        total_to_write = len(unique_filtered)
        last_percent = -1
        for row in unique_filtered:
            # Determine which name(s) caused the filtering
            text_lower = row.get('text', '').lower()
            matched_names = []
            for name_lower in limited_names_lower:
                if re.search(rf'\b{re.escape(name_lower)}\b', text_lower):
                    matched_names.append(name_mapping[name_lower])
            
            reason = f"name_limit_{'+'.join(matched_names)}" if matched_names else "name_limit"
            filtered_writer.writerow({
                'id': row['id'],
                'text': row['text'],
                'filter_reason': reason
            })
            written += 1
            
            # Show progress every 10% or at the end
            if total_to_write > 0:
                percent = int(100 * written / total_to_write)
                if (percent != last_percent and percent % 10 == 0) or written == total_to_write:
                    print(f"    Progress: {percent}% ({written:,}/{total_to_write:,} sentences)", end='\r')
                    last_percent = percent
        
        # Clear progress line
        if total_to_write > 0:
            print(f"    Progress: 100% ({written:,}/{total_to_write:,} sentences)")
    
    # Summary
    print()
    print("=" * 60)
    print("NAME LIMIT FILTERING - SUMMARY")
    print("=" * 60)
    print(f"Total input sentences: {total_sentences:,}")
    print(f"Filtered out:          {total_filtered:,}")
    print(f"Kept:                  {len(final_sentences):,}")
    print()
    print("Name distribution in filtered dataset:")
    if final_sentences:
        for name_lower in limited_names_lower:
            original_name = name_mapping[name_lower]
            final_count = sum(1 for s in final_sentences if re.search(rf'\b{re.escape(name_lower)}\b', s.get('text', '').lower()))
            print(f"  - '{original_name}': {final_count:,} ({100*final_count/len(final_sentences):.2f}%) [limit: {name_limit:,}]")
        
        without_count = len([s for s in final_sentences if not any(
            re.search(rf'\b{re.escape(name_lower)}\b', s.get('text', '').lower()) 
            for name_lower in limited_names_lower
        )])
        print(f"  - Without limited names: {without_count:,} ({100*without_count/len(final_sentences):.2f}%)")
    print()
    print(f"Output: {output_file}")
    print(f"Filtered out: {filtered_output_file}")


def random_sample_sentences(
    input_file: Path,
    output_file: Path,
    sample_size: int,
    data_dir: str = None,
    seed: int = None,
):
    """
    Randomly sample sentences from the input file.
    This is a simple random sample - name filtering should be done separately first.
    
    Args:
        input_file: Path to input CSV file
        output_file: Path to output CSV file with sampled sentences
        sample_size: Number of sentences to randomly sample
        data_dir: Base data directory (for path resolution)
        seed: Random seed for reproducibility (optional)
    """
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    if seed is not None:
        random.seed(seed)
    
    print(f"Step: Random sampling")
    print(f"Input: {input_file}")
    print(f"Sample size: {sample_size:,}")
    if seed is not None:
        print(f"Random seed: {seed}")
    print()
    
    # Read all sentences
    print("  Reading sentences...")
    all_sentences = []
    with open(input_file, 'r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in, delimiter='\t')
        fieldnames = reader.fieldnames
        
        for row in reader:
            all_sentences.append(row)
    
    total_sentences = len(all_sentences)
    print(f"  Total sentences in file: {total_sentences:,}")
    
    # Determine actual sample size
    actual_sample_size = min(sample_size, total_sentences)
    if actual_sample_size < sample_size:
        print(f"  ⚠ Warning: Requested {sample_size:,} sentences but only {total_sentences:,} available")
    
    # Take a random sample
    print(f"\n  Randomly sampling {actual_sample_size:,} sentences...")
    sampled_sentences = random.sample(all_sentences, actual_sample_size)
    print(f"  Sampled {len(sampled_sentences):,} sentences")
    
    # Shuffle the sample
    random.shuffle(sampled_sentences)
    
    # Write to output
    print(f"\n  Writing sampled sentences...")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8', newline='') as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter='\t')
        writer.writeheader()
        for row in sampled_sentences:
            writer.writerow(row)
    
    # Summary
    print()
    print("=" * 60)
    print("RANDOM SAMPLING - SUMMARY")
    print("=" * 60)
    print(f"Total sentences:    {total_sentences:,}")
    print(f"Sampled:            {len(sampled_sentences):,}")
    print(f"Percentage:         {100*len(sampled_sentences)/total_sentences:.1f}%")
    print()
    print(f"Output: {output_file}")


def filter_sentences(data_dir: str = None):
    """
    Run all filtering steps in sequence.
    
    Args:
        data_dir: Base data directory
    """
    # Determine paths
    if data_dir is None:
        script_dir = Path(__file__).parent
        data_dir = str(script_dir.parent / "data")
    
    data_path = Path(data_dir)
    output_path = data_path / "intermediate_outputs"
    output_path.mkdir(parents=True, exist_ok=True)
    
    input_file = output_path / "english_sentences.csv"
    intermediate_file = output_path / "filtered_length_banned.csv"
    output_file = output_path / "filtered_sentences.csv"
    filtered_output_file = output_path / "filtered_out_sentences.csv"
    
    # Step 1: Filter by length and banned words
    filter_by_length_and_banned_words(
        input_file=input_file,
        output_file=intermediate_file,
        filtered_output_file=filtered_output_file,
        data_dir=data_dir,
    )
    
    print()
    
    # Step 2: Filter by moderation
    filter_by_moderation(
        input_file=intermediate_file,
        output_file=output_file,
        filtered_output_file=filtered_output_file,
        data_dir=data_dir,
    )


if __name__ == "__main__":
    filter_sentences()
