"""
Script to evaluate the spacy_classifier against ground truth CEFR ratings
from the SCoRE and Wiki-Auto datasets.
"""

import sys
from pathlib import Path
from typing import List, Dict, Tuple
import pandas as pd
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from multiprocessing import cpu_count
import os
import time
import warnings

# Suppress NumPy warnings in multiprocessing
warnings.filterwarnings('ignore', category=UserWarning, module='torch')

# Add parent directory to path to import spacy_classifier
sys.path.append(str(Path(__file__).parent.parent))
from spacy_classifier import SentenceClassifier


# Mapping from numeric ratings (1-6) to CEFR levels
RATING_TO_CEFR = {
    1: 'A1',
    2: 'A2',
    3: 'B1',
    4: 'B2',
    5: 'C1',
    6: 'C2'
}

CEFR_TO_RATING = {v: k for k, v in RATING_TO_CEFR.items()}


def read_cefr_file(file_path: Path) -> List[Dict]:
    """
    Read a CEFR-labeled sentence file.
    
    Returns:
        List of dicts with keys: sentence, rating1, rating2, cefr1, cefr2
    """
    sentences = []
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            parts = line.split('\t')
            if len(parts) != 3:
                print(f"Warning: Line {line_num} in {file_path.name} has {len(parts)} parts, expected 3. Skipping.")
                continue
            
            sentence, rating1_str, rating2_str = parts
            
            try:
                rating1 = int(rating1_str)
                rating2 = int(rating2_str)
                
                if rating1 not in RATING_TO_CEFR or rating2 not in RATING_TO_CEFR:
                    print(f"Warning: Invalid ratings at line {line_num}: {rating1}, {rating2}. Skipping.")
                    continue
                
                sentences.append({
                    'sentence': sentence,
                    'rating1': rating1,
                    'rating2': rating2,
                    'cefr1': RATING_TO_CEFR[rating1],
                    'cefr2': RATING_TO_CEFR[rating2],
                    'file': file_path.name
                })
            except ValueError:
                print(f"Warning: Could not parse ratings at line {line_num}: '{rating1_str}', '{rating2_str}'. Skipping.")
                continue
    
    return sentences


def get_all_cefr_files(base_dir: Path) -> List[Path]:
    """Get all .txt files from SCoRE and Wiki-Auto subdirectories."""
    files = []
    
    score_dir = base_dir / "SCoRE"
    wikiauto_dir = base_dir / "Wiki-Auto"
    
    if score_dir.exists():
        files.extend(score_dir.glob("*.txt"))
    
    if wikiauto_dir.exists():
        files.extend(wikiauto_dir.glob("*.txt"))
    
    return sorted(files)


def calculate_distance(predicted: str, actual: str) -> int:
    """Calculate the distance between two CEFR levels (0-5)."""
    levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    try:
        pred_idx = levels.index(predicted)
        actual_idx = levels.index(actual)
        return abs(pred_idx - actual_idx)
    except ValueError:
        return -1


def classify_batch(batch_data: List[Dict]) -> List[Dict]:
    """
    Classify a batch of sentences. This function is called in parallel.
    
    Args:
        batch_data: List of sentence dictionaries
        
    Returns:
        List of classification results
    """
    # Create a classifier instance for this worker
    classifier = SentenceClassifier()
    
    levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    
    results = []
    for item in batch_data:
        sentence = item['sentence']
        cefr1 = item['cefr1']
        cefr2 = item['cefr2']
        
        # Classify
        classifier.sentence(sentence)
        predicted = classifier.sentence_difficulty()
        
        # Calculate matches and distances
        matches_rating1 = (predicted == cefr1)
        matches_rating2 = (predicted == cefr2)
        matches_either = matches_rating1 or matches_rating2
        
        distance1 = calculate_distance(predicted, cefr1)
        distance2 = calculate_distance(predicted, cefr2)
        min_distance = min(distance1, distance2)
        
        # Calculate average distance (from midpoint of two ratings)
        rating1_idx = levels.index(cefr1)
        rating2_idx = levels.index(cefr2)
        pred_idx = levels.index(predicted)
        avg_rating = (rating1_idx + rating2_idx) / 2.0
        avg_distance = abs(pred_idx - avg_rating)
        
        # Store result
        results.append({
            'sentence': sentence,
            'cefr1': cefr1,
            'cefr2': cefr2,
            'rating1_idx': rating1_idx,
            'rating2_idx': rating2_idx,
            'predicted': predicted,
            'matches_rating1': matches_rating1,
            'matches_rating2': matches_rating2,
            'matches_either': matches_either,
            'distance1': distance1,
            'distance2': distance2,
            'min_distance': min_distance,
            'avg_distance': avg_distance,
            'file': item['file']
        })
    
    return results


def evaluate_classifier(data_dir: Path, max_sentences: int = None):
    """
    Evaluate the spacy classifier against ground truth CEFR ratings.
    
    Args:
        data_dir: Path to the cefr_labeled_sentences directory
        max_sentences: Maximum number of sentences to evaluate (None for all)
    """
    print("="*80)
    print("EVALUATING SPACY CLASSIFIER AGAINST GROUND TRUTH")
    print("="*80)
    
    # Get all files
    files = get_all_cefr_files(data_dir)
    print(f"\nFound {len(files)} files:")
    for f in files:
        print(f"  - {f.relative_to(data_dir)}")
    
    # Read all sentences
    print("\nReading sentences...")
    all_sentences = []
    for file_path in files:
        sentences = read_cefr_file(file_path)
        all_sentences.extend(sentences)
        print(f"  {file_path.name}: {len(sentences)} sentences")
    
    print(f"\nTotal sentences: {len(all_sentences)}")
    
    # Filter out sentences with 30+ words
    print("\nFiltering sentences...")
    original_count = len(all_sentences)
    filtered_sentences = []
    long_sentence_count = 0
    
    for sentence_data in all_sentences:
        word_count = len(sentence_data['sentence'].split())
        if word_count >= 30:
            long_sentence_count += 1
        else:
            filtered_sentences.append(sentence_data)
    
    all_sentences = filtered_sentences
    print(f"Filtered out {long_sentence_count} sentences with 30+ words")
    print(f"Remaining sentences: {len(all_sentences)} ({len(all_sentences)/original_count*100:.1f}% of original)")
    
    # Limit to at most 200 sentences per difficulty level
    import random
    random.seed(42)
    print("\nLimiting to at most 200 sentences per difficulty level...")
    sentences_by_difficulty = defaultdict(list)
    for sentence_data in all_sentences:
        # Group by cefr1 (first rating)
        sentences_by_difficulty[sentence_data['cefr1']].append(sentence_data)
    
    limited_sentences = []
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        level_sentences = sentences_by_difficulty[level]
        if len(level_sentences) > 200:
            sampled = random.sample(level_sentences, 200)
            limited_sentences.extend(sampled)
            print(f"  {level}: {len(level_sentences)} → 200 (sampled)")
        else:
            limited_sentences.extend(level_sentences)
            print(f"  {level}: {len(level_sentences)} (all used)")
    
    all_sentences = limited_sentences
    print(f"Total sentences after limiting: {len(all_sentences)}")
    
    # Limit if requested (this now applies after per-level limiting)
    if max_sentences and max_sentences < len(all_sentences):
        all_sentences = random.sample(all_sentences, max_sentences)
        print(f"Randomly sampled {max_sentences} sentences for evaluation")
    
    # Evaluate sentences in parallel using processes
    print("\nClassifying sentences in parallel...")
    
    # Determine number of workers
    num_workers = max(1, cpu_count() - 1)  # Leave one CPU free
    print(f"Using {num_workers} parallel workers (process-based, CPU count: {cpu_count()})")
    
    # Split sentences into batches for parallel processing
    batch_size = max(10, len(all_sentences) // (num_workers * 4))  # Create more batches than workers
    batches = []
    for i in range(0, len(all_sentences), batch_size):
        batches.append(all_sentences[i:i + batch_size])
    
    print(f"Processing {len(all_sentences)} sentences in {len(batches)} batches (batch size: ~{batch_size})...")
    
    # Start timing
    start_time = time.time()
    
    # Process batches in parallel
    results = []
    completed_count = 0
    last_print_time = start_time
    
    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        # Submit all batches
        future_to_batch = {executor.submit(classify_batch, batch): i 
                          for i, batch in enumerate(batches)}
        
        # Collect results as they complete
        for future in as_completed(future_to_batch):
            batch_idx = future_to_batch[future]
            try:
                batch_results = future.result()
                results.extend(batch_results)
                completed_count += len(batch_results)
                
                # Print progress (throttle to avoid too much output)
                current_time = time.time()
                if current_time - last_print_time >= 1.0 or completed_count == len(all_sentences):
                    progress = completed_count / len(all_sentences) * 100
                    elapsed = current_time - start_time
                    rate = completed_count / elapsed if elapsed > 0 else 0
                    eta = (len(all_sentences) - completed_count) / rate if rate > 0 else 0
                    
                    print(f"  Progress: {completed_count}/{len(all_sentences)} ({progress:.1f}%) - "
                          f"Rate: {rate:.1f} sentences/sec - ETA: {eta:.0f}s")
                    last_print_time = current_time
                
            except Exception as exc:
                print(f"  Batch {batch_idx} generated an exception: {exc}")
    
    # End timing
    end_time = time.time()
    total_time = end_time - start_time
    
    print(f"\n  ✓ Completed! Processed {len(results)} sentences in {total_time:.1f} seconds")
    print(f"  Average rate: {len(results)/total_time:.1f} sentences/second")
    
    # Calculate statistics from results
    levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    exact_match_rating1 = 0
    exact_match_rating2 = 0
    match_either = 0
    total_distance_rating1 = 0
    total_distance_rating2 = 0
    min_distance_sum = 0
    avg_distance_sum = 0
    
    # Track confusion matrix
    confusion_by_cefr1 = defaultdict(lambda: defaultdict(int))
    confusion_by_cefr2 = defaultdict(lambda: defaultdict(int))
    
    # Track distance distributions
    distance_distribution = defaultdict(int)
    avg_distance_distribution = defaultdict(int)
    signed_distance_distribution = defaultdict(int)
    
    # Aggregate statistics
    for result in results:
        # Update statistics
        if result['matches_rating1']:
            exact_match_rating1 += 1
        if result['matches_rating2']:
            exact_match_rating2 += 1
        if result['matches_either']:
            match_either += 1
        
        total_distance_rating1 += result['distance1']
        total_distance_rating2 += result['distance2']
        min_distance_sum += result['min_distance']
        avg_distance_sum += result['avg_distance']
        
        # Update confusion matrices
        confusion_by_cefr1[result['cefr1']][result['predicted']] += 1
        confusion_by_cefr2[result['cefr2']][result['predicted']] += 1
        
        # Update distance distributions
        distance_distribution[result['min_distance']] += 1
        
        # Bucket avg_distance for distribution
        # Round to nearest 0.5
        bucketed_distance = round(result['avg_distance'] * 2) / 2
        avg_distance_distribution[bucketed_distance] += 1
        
        # Track signed distance (Positive = too high, Negative = too low)
        avg_rating = (result['rating1_idx'] + result['rating2_idx']) / 2.0
        pred_idx = levels.index(result['predicted'])
        signed_diff = pred_idx - avg_rating
        bucketed_signed = round(signed_diff * 2) / 2
        signed_distance_distribution[bucketed_signed] += 1
    
    # Calculate overall statistics
    total = len(results)
    if total == 0:
        print("Error: No results to analyze.")
        return
    
    print("\n" + "="*80)
    print("EVALUATION RESULTS")
    print("="*80)
    
    print(f"\nTotal sentences evaluated: {total}")
    print(f"(Sentences with 30+ words were filtered out before evaluation)")
    print(f"Processing time: {total_time:.1f} seconds ({len(results)/total_time:.1f} sentences/sec)")
    print(f"Parallel workers used: {num_workers}")
    
    print("\n--- Exact Match Statistics ---")
    print(f"Matches Rating 1:          {exact_match_rating1:5d} ({exact_match_rating1/total*100:5.1f}%)")
    print(f"Matches Rating 2:          {exact_match_rating2:5d} ({exact_match_rating2/total*100:5.1f}%)")
    print(f"Matches Either Rating:     {match_either:5d} ({match_either/total*100:5.1f}%)")
    
    print("\n--- Distance Statistics ---")
    avg_distance1 = total_distance_rating1 / total
    avg_distance2 = total_distance_rating2 / total
    avg_min_distance = min_distance_sum / total
    avg_avg_distance = avg_distance_sum / total
    
    print(f"Average distance from Rating 1:        {avg_distance1:.2f}")
    print(f"Average distance from Rating 2:        {avg_distance2:.2f}")
    print(f"Average minimum distance:              {avg_min_distance:.2f}")
    print(f"Average distance from rating average:  {avg_avg_distance:.2f}")
    
    print("\n--- Distance Distribution (from average rating) ---")
    for distance in sorted(avg_distance_distribution.keys()):
        count = avg_distance_distribution[distance]
        percentage = count / total * 100
        bar = '█' * int(percentage / 2)
        print(f"Distance {distance:>4.1f}: {count:5d} ({percentage:5.1f}%) {bar}")
    
    print("\n--- Signed Distance Distribution (Predicted - Actual) ---")
    print("(Positive = Predicted too high, Negative = Predicted too low)")
    for distance in sorted(signed_distance_distribution.keys()):
        count = signed_distance_distribution[distance]
        percentage = count / total * 100
        bar = '█' * int(percentage / 2)
        sign = "+" if distance > 0 else ""
        print(f"Distance {sign}{distance:>4.1f}: {count:5d} ({percentage:5.1f}%) {bar}")
    
    # Within 1 level accuracy
    within_1 = sum(avg_distance_distribution[d] for d in avg_distance_distribution.keys() if d <= 1.0)
    print(f"\nWithin 1 level of average rating: {within_1:5d} ({within_1/total*100:5.1f}%)")
    
    # Detailed analysis of prediction errors (using average distance)
    print("\n" + "="*80)
    print("PREDICTION ERROR ANALYSIS (Directional)")
    print("="*80)
    print("Note: Distance calculated from average of two ground truth ratings")
    print()
    
    # Calculate directional errors using average distance
    exact_match = 0
    within_one_too_high = 0
    within_one_too_low = 0
    more_than_one_too_high = 0
    more_than_one_too_low = 0
    
    levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    
    for result in results:
        # Calculate signed difference from average rating
        avg_rating = (result['rating1_idx'] + result['rating2_idx']) / 2.0
        pred_idx = levels.index(result['predicted'])
        signed_diff = pred_idx - avg_rating  # positive = too high, negative = too low
        
        if signed_diff == 0:
            exact_match += 1
        elif 0 < signed_diff <= 1:
            within_one_too_high += 1
        elif -1 <= signed_diff < 0:
            within_one_too_low += 1
        elif signed_diff > 1:
            more_than_one_too_high += 1
        elif signed_diff < -1:
            more_than_one_too_low += 1
    
    # Print summary
    print(f"{'Category':<40} {'Count':<10} {'Percentage':<12}")
    print("-" * 65)
    print(f"{'Exact Match (0 levels off)':<40} {exact_match:<10} {exact_match/total*100:>10.1f}%")
    print(f"{'≤1 Level Too High (0 < distance ≤ 1)':<40} {within_one_too_high:<10} {within_one_too_high/total*100:>10.1f}%")
    print(f"{'≤1 Level Too Low (-1 ≤ distance < 0)':<40} {within_one_too_low:<10} {within_one_too_low/total*100:>10.1f}%")
    print(f"{'  → Total Within 1 Level (|distance| ≤ 1)':<40} {within_one_too_high + within_one_too_low:<10} {(within_one_too_high + within_one_too_low)/total*100:>10.1f}%")
    print(f"{'>1 Level Too High (distance > 1)':<40} {more_than_one_too_high:<10} {more_than_one_too_high/total*100:>10.1f}%")
    print(f"{'>1 Level Too Low (distance < -1)':<40} {more_than_one_too_low:<10} {more_than_one_too_low/total*100:>10.1f}%")
    print(f"{'  → Total >1 Level Off (|distance| > 1)':<40} {more_than_one_too_high + more_than_one_too_low:<10} {(more_than_one_too_high + more_than_one_too_low)/total*100:>10.1f}%")
    print("-" * 65)
    print(f"{'At Most 1 Level Off (|distance| ≤ 1)':<40} {exact_match + within_one_too_high + within_one_too_low:<10} {(exact_match + within_one_too_high + within_one_too_low)/total*100:>10.1f}%")
    print(f"{'More Than 1 Level Off (|distance| > 1)':<40} {more_than_one_too_high + more_than_one_too_low:<10} {(more_than_one_too_high + more_than_one_too_low)/total*100:>10.1f}%")
    
    # Bias summary
    print(f"\n{'Overall Bias Analysis:'}")
    total_too_high = within_one_too_high + more_than_one_too_high
    total_too_low = within_one_too_low + more_than_one_too_low
    print(f"  Total predictions too high: {total_too_high} ({total_too_high/total*100:.1f}%)")
    print(f"  Total predictions too low:  {total_too_low} ({total_too_low/total*100:.1f}%)")
    
    if total_too_high > total_too_low:
        bias_diff = total_too_high - total_too_low
        print(f"  → Classifier tends to predict TOO HIGH by {bias_diff/total*100:.1f} percentage points")
    elif total_too_low > total_too_high:
        bias_diff = total_too_low - total_too_high
        print(f"  → Classifier tends to predict TOO LOW by {bias_diff/total*100:.1f} percentage points")
    else:
        print(f"  → Classifier is balanced (no systematic bias)")
    
    # Average distance statistics
    avg_distances = [r['avg_distance'] for r in results]
    avg_avg_distance = sum(avg_distances) / len(avg_distances)
    print(f"\n  Average distance from ground truth: {avg_avg_distance:.2f} levels")
    
    # Confusion matrix for Rating 1
    print("\n" + "="*80)
    print("CONFUSION MATRIX - Rating 1")
    print("="*80)
    print("Rows = Ground Truth (Actual), Columns = Our Classifier (Predicted)")
    print()
    levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    
    # Print header with clearer labels
    print(f"{'Ground':>10} │", end='')
    print(f"{'Our Classifier Predicted →':^56} │")
    print(f"{'Truth ↓':>10} │", end='')
    for level in levels:
        print(f"{level:>8}", end='')
    print(f"{'Total':>8} │ {'Accuracy':>10}")
    print("─" * 10 + "┼" + "─" * 56 + "┼" + "─" * 11)
    
    # Print rows with accuracy
    for actual in levels:
        print(f"{actual:>10} │", end='')
        row_total = 0
        correct = 0
        for predicted in levels:
            count = confusion_by_cefr1[actual][predicted]
            row_total += count
            if actual == predicted:
                correct = count
                # Highlight diagonal (correct predictions) with asterisk
                print(f" *{count:>6}", end='')
            else:
                print(f"{count:>8}", end='')
        accuracy = (correct / row_total * 100) if row_total > 0 else 0
        print(f"{row_total:>8} │ {accuracy:>9.1f}%")
    
    # Print column totals
    print("─" * 10 + "┼" + "─" * 56 + "┼" + "─" * 11)
    print(f"{'Total':>10} │", end='')
    for level in levels:
        col_total = sum(confusion_by_cefr1[actual][level] for actual in levels)
        print(f"{col_total:>8}", end='')
    print(f"{total:>8} │")
    
    # Confusion matrix for Rating 2
    print("\n" + "="*80)
    print("CONFUSION MATRIX - Rating 2")
    print("="*80)
    print("Rows = Ground Truth (Actual), Columns = Our Classifier (Predicted)")
    print()
    
    # Print header with clearer labels
    print(f"{'Ground':>10} │", end='')
    print(f"{'Our Classifier Predicted →':^56} │")
    print(f"{'Truth ↓':>10} │", end='')
    for level in levels:
        print(f"{level:>8}", end='')
    print(f"{'Total':>8} │ {'Accuracy':>10}")
    print("─" * 10 + "┼" + "─" * 56 + "┼" + "─" * 11)
    
    # Print rows with accuracy
    for actual in levels:
        print(f"{actual:>10} │", end='')
        row_total = 0
        correct = 0
        for predicted in levels:
            count = confusion_by_cefr2[actual][predicted]
            row_total += count
            if actual == predicted:
                correct = count
                # Highlight diagonal (correct predictions) with asterisk
                print(f" *{count:>6}", end='')
            else:
                print(f"{count:>8}", end='')
        accuracy = (correct / row_total * 100) if row_total > 0 else 0
        print(f"{row_total:>8} │ {accuracy:>9.1f}%")
    
    # Print column totals
    print("─" * 10 + "┼" + "─" * 56 + "┼" + "─" * 11)
    print(f"{'Total':>10} │", end='')
    for level in levels:
        col_total = sum(confusion_by_cefr2[actual][level] for actual in levels)
        print(f"{col_total:>8}", end='')
    print(f"{total:>8} │")
    
    # Additional analyses for tuning
    print("\n" + "="*80)
    print("DETAILED MISCLASSIFICATION ANALYSIS")
    print("="*80)
    
    # Analyze over/under classification tendencies
    print("\n--- Over/Under Classification Tendencies ---")
    print("(Positive = We classify too high, Negative = We classify too low)")
    print("Note: Using average of two ground truth ratings")
    print()
    
    level_differences = defaultdict(list)
    level_avg_differences = defaultdict(list)
    
    for result in results:
        # Calculate difference from average rating
        avg_rating = (result['rating1_idx'] + result['rating2_idx']) / 2.0
        pred_idx = levels.index(result['predicted'])
        avg_diff = pred_idx - avg_rating
        
        # Also track by closest level for the table
        if result['distance1'] <= result['distance2']:
            closest_level = result['cefr1']
        else:
            closest_level = result['cefr2']
        
        level_avg_differences[closest_level].append(avg_diff)
        level_differences[closest_level].append(avg_diff)
    
    print(f"{'Level':<10} {'Avg Diff':<12} {'Tendency':<20} {'Count':<10}")
    print("-" * 60)
    for level in levels:
        if level_differences[level]:
            avg_diff = sum(level_differences[level]) / len(level_differences[level])
            count = len(level_differences[level])
            
            if avg_diff > 0.5:
                tendency = "TOO HIGH ↑"
            elif avg_diff < -0.5:
                tendency = "TOO LOW ↓"
            else:
                tendency = "BALANCED"
            
            print(f"{level:<10} {avg_diff:>+10.2f}   {tendency:<20} {count:<10}")
    
    # Analyze word count vs accuracy
    print("\n" + "="*80)
    print("WORD COUNT VS ACCURACY ANALYSIS")
    print("="*80)
    print()
    
    # Calculate word counts for each sentence
    word_count_accuracy = defaultdict(lambda: {'correct': 0, 'total': 0})
    
    for result in results:
        sentence = result['sentence']
        # Simple word count (split by spaces)
        word_count = len(sentence.split())
        
        # Bucket word counts
        if word_count <= 5:
            bucket = '1-5'
        elif word_count <= 10:
            bucket = '6-10'
        elif word_count <= 15:
            bucket = '11-15'
        elif word_count <= 20:
            bucket = '16-20'
        elif word_count <= 25:
            bucket = '21-25'
        else:
            bucket = '26+'
        
        word_count_accuracy[bucket]['total'] += 1
        if result['matches_either']:
            word_count_accuracy[bucket]['correct'] += 1
    
    print(f"{'Word Count':<15} {'Correct':<10} {'Total':<10} {'Accuracy':<12}")
    print("-" * 50)
    buckets_order = ['1-5', '6-10', '11-15', '16-20', '21-25', '26+']
    for bucket in buckets_order:
        if word_count_accuracy[bucket]['total'] > 0:
            correct_count = word_count_accuracy[bucket]['correct']
            bucket_total = word_count_accuracy[bucket]['total']
            accuracy = correct_count / bucket_total * 100
            print(f"{bucket:<15} {correct_count:<10} {bucket_total:<10} {accuracy:>10.1f}%")
    
    # Most common misclassification patterns
    print("\n" + "="*80)
    print("MOST COMMON MISCLASSIFICATION PATTERNS")
    print("="*80)
    print("(Ground Truth → Our Prediction)")
    print()
    
    misclassification_patterns = defaultdict(int)
    for result in results:
        if not result['matches_either']:
            # Use the closer ground truth
            if result['distance1'] <= result['distance2']:
                true_level = result['cefr1']
            else:
                true_level = result['cefr2']
            
            pattern = f"{true_level} → {result['predicted']}"
            misclassification_patterns[pattern] += 1
    
    sorted_patterns = sorted(misclassification_patterns.items(), key=lambda x: x[1], reverse=True)
    
    print(f"{'Pattern':<15} {'Count':<10} {'% of Errors':<15}")
    print("-" * 45)
    total_errors = sum(misclassification_patterns.values())
    for pattern, count in sorted_patterns[:15]:  # Top 15 patterns
        percentage = count / total_errors * 100
        bar = '█' * int(percentage / 2)
        print(f"{pattern:<15} {count:<10} {percentage:>12.1f}% {bar}")
    
    # Example sentences for top misclassifications
    print("\n" + "="*80)
    print("EXAMPLE SENTENCES FOR TOP MISCLASSIFICATIONS")
    print("="*80)
    
    # Get top 5 misclassification patterns
    top_patterns = sorted_patterns[:5]
    
    for pattern, count in top_patterns:
        print(f"\n--- {pattern} ({count} cases) ---")
        
        # Extract true and predicted levels
        true_level, pred_level = pattern.split(' → ')
        
        # Find example sentences
        examples = []
        for result in results:
            if len(examples) >= 3:  # Show 3 examples per pattern
                break
            
            # Check if this result matches the pattern
            if result['predicted'] == pred_level:
                if result['cefr1'] == true_level or result['cefr2'] == true_level:
                    examples.append(result['sentence'])
        
        for i, example in enumerate(examples, 1):
            print(f"  {i}. {example}")
    
    # Accuracy by ground truth level
    print("\n" + "="*80)
    print("ACCURACY BY GROUND TRUTH LEVEL")
    print("="*80)
    print()
    
    level_accuracy = defaultdict(lambda: {'match_rating1': 0, 'match_rating2': 0, 'match_either': 0, 'total': 0})
    
    for result in results:
        for rating_key in ['cefr1', 'cefr2']:
            level = result[rating_key]
            level_accuracy[level]['total'] += 1
            
            if rating_key == 'cefr1' and result['matches_rating1']:
                level_accuracy[level]['match_rating1'] += 1
            if rating_key == 'cefr2' and result['matches_rating2']:
                level_accuracy[level]['match_rating2'] += 1
            if result['matches_either']:
                level_accuracy[level]['match_either'] += 1
    
    print(f"{'Level':<10} {'Match Either':<15} {'Total Labels':<15} {'Accuracy':<12}")
    print("-" * 55)
    for level in levels:
        if level_accuracy[level]['total'] > 0:
            match_either_count = level_accuracy[level]['match_either']
            level_total = level_accuracy[level]['total']
            accuracy = match_either_count / level_total * 100
            print(f"{level:<10} {match_either_count:<15} {level_total:<15} {accuracy:>10.1f}%")
    
    # Recommendations for tuning
    print("\n" + "="*80)
    print("RECOMMENDATIONS FOR TUNING THE CLASSIFIER")
    print("="*80)
    print()
    
    recommendations = []
    
    # Check if we're consistently over or under classifying
    for level in levels:
        if level_differences[level]:
            avg_diff = sum(level_differences[level]) / len(level_differences[level])
            if avg_diff > 0.7:
                recommendations.append(
                    f"• {level} sentences are classified TOO HIGH (avg +{avg_diff:.2f} levels)\n"
                    f"  → Consider relaxing constraints for {level} (increase word limits or allow more higher-level words)"
                )
            elif avg_diff < -0.7:
                recommendations.append(
                    f"• {level} sentences are classified TOO LOW (avg {avg_diff:.2f} levels)\n"
                    f"  → Consider tightening constraints for {level} (decrease word limits or reduce higher-level word allowances)"
                )
    
    # Check word count accuracy patterns
    low_accuracy_buckets = []
    for bucket in buckets_order:
        if word_count_accuracy[bucket]['total'] > 0:
            accuracy = word_count_accuracy[bucket]['correct'] / word_count_accuracy[bucket]['total'] * 100
            if accuracy < 30:  # Less than 30% accurate
                low_accuracy_buckets.append((bucket, accuracy))
    
    if low_accuracy_buckets:
        recommendations.append(
            f"• Word count ranges with low accuracy: {', '.join(b[0] for b in low_accuracy_buckets)}\n"
            f"  → Review word count limits in DEFAULT_DIFFICULTY_CONFIG for these ranges"
        )
    
    # Check for systematic over-prediction of certain levels
    our_predictions = defaultdict(int)
    for result in results:
        our_predictions[result['predicted']] += 1
    
    ground_truth_dist = defaultdict(int)
    for result in results:
        ground_truth_dist[result['cefr1']] += 1
        ground_truth_dist[result['cefr2']] += 1
    
    for level in levels:
        pred_pct = our_predictions[level] / total * 100
        truth_pct = ground_truth_dist[level] / (total * 2) * 100  # *2 because we have two ratings per sentence
        
        if pred_pct > truth_pct * 1.5:  # We predict this level 50% more than it appears
            recommendations.append(
                f"• We over-predict {level}: {pred_pct:.1f}% of predictions vs {truth_pct:.1f}% in ground truth\n"
                f"  → Review level_limits for {level} - may be too permissive"
            )
        elif pred_pct < truth_pct * 0.5 and truth_pct > 5:  # We under-predict by 50% (if it's common enough)
            recommendations.append(
                f"• We under-predict {level}: {pred_pct:.1f}% of predictions vs {truth_pct:.1f}% in ground truth\n"
                f"  → Review level_limits for {level} - may be too restrictive"
            )
    
    # Print recommendations
    if recommendations:
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec}\n")
    else:
        print("No major issues detected. Classifier is reasonably well-calibrated.\n")
    
    # Per-file statistics
    print("\n" + "="*80)
    print("PER-FILE STATISTICS")
    print("="*80)
    
    df = pd.DataFrame(results)
    for file_name in df['file'].unique():
        file_df = df[df['file'] == file_name]
        file_total = len(file_df)
        file_matches = file_df['matches_either'].sum()
        file_min_distance = file_df['min_distance'].mean()
        file_avg_distance = file_df['avg_distance'].mean()
        
        print(f"\n{file_name}:")
        print(f"  Total sentences:            {file_total}")
        print(f"  Matches either rating:      {file_matches} ({file_matches/file_total*100:.1f}%)")
        print(f"  Average min distance:       {file_min_distance:.2f}")
        print(f"  Average distance from avg:  {file_avg_distance:.2f}")
    
    # Save detailed results to CSV
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / "classifier_evaluation_results.csv"
    
    df.to_csv(output_file, index=False)
    print(f"\n\nDetailed results saved to: {output_file}")
    
    # Save summary report
    report_file = output_dir / "classifier_evaluation_report.txt"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("SPACY CLASSIFIER EVALUATION REPORT\n")
        f.write("="*80 + "\n\n")
        
        f.write(f"Total sentences evaluated: {total}\n")
        f.write(f"(Sentences with 30+ words were filtered out before evaluation)\n")
        f.write(f"Processing time: {total_time:.1f} seconds ({len(results)/total_time:.1f} sentences/sec)\n")
        f.write(f"Parallel workers used: {num_workers}\n\n")
        
        f.write("--- Exact Match Statistics ---\n")
        f.write(f"Matches Rating 1:          {exact_match_rating1:5d} ({exact_match_rating1/total*100:5.1f}%)\n")
        f.write(f"Matches Rating 2:          {exact_match_rating2:5d} ({exact_match_rating2/total*100:5.1f}%)\n")
        f.write(f"Matches Either Rating:     {match_either:5d} ({match_either/total*100:5.1f}%)\n\n")
        
        f.write("--- Distance Statistics ---\n")
        f.write(f"Average distance from Rating 1:        {avg_distance1:.2f}\n")
        f.write(f"Average distance from Rating 2:        {avg_distance2:.2f}\n")
        f.write(f"Average minimum distance:              {avg_min_distance:.2f}\n")
        f.write(f"Average distance from rating average:  {avg_avg_distance:.2f}\n\n")
        
        f.write("--- Distance Distribution (from average rating) ---\n")
        for distance in sorted(avg_distance_distribution.keys()):
            count = avg_distance_distribution[distance]
            percentage = count / total * 100
            f.write(f"Distance {distance:>4.1f}: {count:5d} ({percentage:5.1f}%)\n")
        
        f.write("\n--- Signed Distance Distribution (Predicted - Actual) ---\n")
        f.write("(Positive = Predicted too high, Negative = Predicted too low)\n")
        for distance in sorted(signed_distance_distribution.keys()):
            count = signed_distance_distribution[distance]
            percentage = count / total * 100
            sign = "+" if distance > 0 else ""
            f.write(f"Distance {sign}{distance:>4.1f}: {count:5d} ({percentage:5.1f}%)\n")
        
        f.write(f"\nWithin 1 level of average rating: {within_1:5d} ({within_1/total*100:5.1f}%)\n")
        
        # Write directional error analysis
        f.write("\n" + "="*80 + "\n")
        f.write("PREDICTION ERROR ANALYSIS (Directional)\n")
        f.write("="*80 + "\n")
        f.write("Note: Distance calculated from average of two ground truth ratings\n\n")
        
        f.write(f"{'Category':<40} {'Count':<10} {'Percentage':<12}\n")
        f.write("-" * 65 + "\n")
        f.write(f"{'Exact Match (0 levels off)':<40} {exact_match:<10} {exact_match/total*100:>10.1f}%\n")
        f.write(f"{'<=1 Level Too High (0 < distance <= 1)':<40} {within_one_too_high:<10} {within_one_too_high/total*100:>10.1f}%\n")
        f.write(f"{'<=1 Level Too Low (-1 <= distance < 0)':<40} {within_one_too_low:<10} {within_one_too_low/total*100:>10.1f}%\n")
        f.write(f"{'  -> Total Within 1 Level (|distance| <= 1)':<40} {within_one_too_high + within_one_too_low:<10} {(within_one_too_high + within_one_too_low)/total*100:>10.1f}%\n")
        f.write(f"{'>1 Level Too High (distance > 1)':<40} {more_than_one_too_high:<10} {more_than_one_too_high/total*100:>10.1f}%\n")
        f.write(f"{'>1 Level Too Low (distance < -1)':<40} {more_than_one_too_low:<10} {more_than_one_too_low/total*100:>10.1f}%\n")
        f.write(f"{'  -> Total >1 Level Off (|distance| > 1)':<40} {more_than_one_too_high + more_than_one_too_low:<10} {(more_than_one_too_high + more_than_one_too_low)/total*100:>10.1f}%\n")
        f.write("-" * 65 + "\n")
        f.write(f"{'At Most 1 Level Off (|distance| <= 1)':<40} {exact_match + within_one_too_high + within_one_too_low:<10} {(exact_match + within_one_too_high + within_one_too_low)/total*100:>10.1f}%\n")
        f.write(f"{'More Than 1 Level Off (|distance| > 1)':<40} {more_than_one_too_high + more_than_one_too_low:<10} {(more_than_one_too_high + more_than_one_too_low)/total*100:>10.1f}%\n")
        
        # Bias summary
        f.write(f"\nOverall Bias Analysis:\n")
        f.write(f"  Total predictions too high: {total_too_high} ({total_too_high/total*100:.1f}%)\n")
        f.write(f"  Total predictions too low:  {total_too_low} ({total_too_low/total*100:.1f}%)\n")
        
        if total_too_high > total_too_low:
            bias_diff = total_too_high - total_too_low
            f.write(f"  -> Classifier tends to predict TOO HIGH by {bias_diff/total*100:.1f} percentage points\n")
        elif total_too_low > total_too_high:
            bias_diff = total_too_low - total_too_high
            f.write(f"  -> Classifier tends to predict TOO LOW by {bias_diff/total*100:.1f} percentage points\n")
        else:
            f.write(f"  -> Classifier is balanced (no systematic bias)\n")
        
        # Average distance
        avg_distances = [r['avg_distance'] for r in results]
        avg_avg_distance = sum(avg_distances) / len(avg_distances)
        f.write(f"\n  Average distance from ground truth: {avg_avg_distance:.2f} levels\n")
        
        f.write("\n")
        
        # Write confusion matrices
        f.write("\n" + "="*80 + "\n")
        f.write("CONFUSION MATRIX - Rating 1\n")
        f.write("="*80 + "\n")
        f.write("Rows = Ground Truth (Actual), Columns = Our Classifier (Predicted)\n")
        f.write("* marks correct predictions on the diagonal\n\n")
        
        f.write(f"{'Ground':>10} | ")
        for level in levels:
            f.write(f"{level:>8}")
        f.write(f"{'Total':>8} | {'Accuracy':>10}\n")
        f.write("-" * 80 + "\n")
        
        for actual in levels:
            f.write(f"{actual:>10} | ")
            row_total = 0
            correct = 0
            for predicted in levels:
                count = confusion_by_cefr1[actual][predicted]
                row_total += count
                if actual == predicted:
                    correct = count
                    f.write(f" *{count:>6}")
                else:
                    f.write(f"{count:>8}")
            accuracy = (correct / row_total * 100) if row_total > 0 else 0
            f.write(f"{row_total:>8} | {accuracy:>9.1f}%\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("CONFUSION MATRIX - Rating 2\n")
        f.write("="*80 + "\n")
        f.write("Rows = Ground Truth (Actual), Columns = Our Classifier (Predicted)\n")
        f.write("* marks correct predictions on the diagonal\n\n")
        
        f.write(f"{'Ground':>10} | ")
        for level in levels:
            f.write(f"{level:>8}")
        f.write(f"{'Total':>8} | {'Accuracy':>10}\n")
        f.write("-" * 80 + "\n")
        
        for actual in levels:
            f.write(f"{actual:>10} | ")
            row_total = 0
            correct = 0
            for predicted in levels:
                count = confusion_by_cefr2[actual][predicted]
                row_total += count
                if actual == predicted:
                    correct = count
                    f.write(f" *{count:>6}")
                else:
                    f.write(f"{count:>8}")
            accuracy = (correct / row_total * 100) if row_total > 0 else 0
            f.write(f"{row_total:>8} | {accuracy:>9.1f}%\n")
        
        # Write additional analyses
        f.write("\n" + "="*80 + "\n")
        f.write("DETAILED MISCLASSIFICATION ANALYSIS\n")
        f.write("="*80 + "\n\n")
        
        f.write("--- Over/Under Classification Tendencies ---\n")
        f.write("(Positive = We classify too high, Negative = We classify too low)\n\n")
        
        f.write(f"{'Level':<10} {'Avg Diff':<12} {'Tendency':<20} {'Count':<10}\n")
        f.write("-" * 60 + "\n")
        for level in levels:
            if level_differences[level]:
                avg_diff = sum(level_differences[level]) / len(level_differences[level])
                count = len(level_differences[level])
                
                if avg_diff > 0.5:
                    tendency = "TOO HIGH"
                elif avg_diff < -0.5:
                    tendency = "TOO LOW"
                else:
                    tendency = "BALANCED"
                
                f.write(f"{level:<10} {avg_diff:>+10.2f}   {tendency:<20} {count:<10}\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("WORD COUNT VS ACCURACY ANALYSIS\n")
        f.write("="*80 + "\n\n")
        
        f.write(f"{'Word Count':<15} {'Correct':<10} {'Total':<10} {'Accuracy':<12}\n")
        f.write("-" * 50 + "\n")
        for bucket in buckets_order:
            if word_count_accuracy[bucket]['total'] > 0:
                bucket_correct = word_count_accuracy[bucket]['correct']
                bucket_total = word_count_accuracy[bucket]['total']
                bucket_accuracy = bucket_correct / bucket_total * 100
                f.write(f"{bucket:<15} {bucket_correct:<10} {bucket_total:<10} {bucket_accuracy:>10.1f}%\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("MOST COMMON MISCLASSIFICATION PATTERNS\n")
        f.write("="*80 + "\n")
        f.write("(Ground Truth -> Our Prediction)\n\n")
        
        f.write(f"{'Pattern':<15} {'Count':<10} {'% of Errors':<15}\n")
        f.write("-" * 45 + "\n")
        for pattern, count in sorted_patterns[:15]:
            percentage = count / total_errors * 100
            f.write(f"{pattern:<15} {count:<10} {percentage:>12.1f}%\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("EXAMPLE SENTENCES FOR TOP MISCLASSIFICATIONS\n")
        f.write("="*80 + "\n")
        
        for pattern, count in top_patterns:
            f.write(f"\n--- {pattern} ({count} cases) ---\n")
            
            true_level, pred_level = pattern.split(' → ')
            
            examples = []
            for result in results:
                if len(examples) >= 3:
                    break
                
                if result['predicted'] == pred_level:
                    if result['cefr1'] == true_level or result['cefr2'] == true_level:
                        examples.append(result['sentence'])
            
            for i, example in enumerate(examples, 1):
                f.write(f"  {i}. {example}\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("ACCURACY BY GROUND TRUTH LEVEL\n")
        f.write("="*80 + "\n\n")
        
        f.write(f"{'Level':<10} {'Match Either':<15} {'Total Labels':<15} {'Accuracy':<12}\n")
        f.write("-" * 55 + "\n")
        for level in levels:
            if level_accuracy[level]['total'] > 0:
                level_match_either = level_accuracy[level]['match_either']
                level_total_labels = level_accuracy[level]['total']
                level_accuracy_pct = level_match_either / level_total_labels * 100
                f.write(f"{level:<10} {level_match_either:<15} {level_total_labels:<15} {level_accuracy_pct:>10.1f}%\n")
        
        f.write("\n" + "="*80 + "\n")
        f.write("RECOMMENDATIONS FOR TUNING THE CLASSIFIER\n")
        f.write("="*80 + "\n\n")
        
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                f.write(f"{i}. {rec}\n\n")
        else:
            f.write("No major issues detected. Classifier is reasonably well-calibrated.\n\n")
        
        # Per-file statistics
        f.write("\n" + "="*80 + "\n")
        f.write("PER-FILE STATISTICS\n")
        f.write("="*80 + "\n")
        
        for file_name in df['file'].unique():
            file_df = df[df['file'] == file_name]
            file_total = len(file_df)
            file_matches = file_df['matches_either'].sum()
            file_min_distance = file_df['min_distance'].mean()
            file_avg_distance = file_df['avg_distance'].mean()
            
            f.write(f"\n{file_name}:\n")
            f.write(f"  Total sentences:            {file_total}\n")
            f.write(f"  Matches either rating:      {file_matches} ({file_matches/file_total*100:.1f}%)\n")
            f.write(f"  Average min distance:       {file_min_distance:.2f}\n")
            f.write(f"  Average distance from avg:  {file_avg_distance:.2f}\n")
    
    print(f"Summary report saved to: {report_file}")
    
    print("\n" + "="*80)
    print("EVALUATION COMPLETE")
    print("="*80)


if __name__ == "__main__":
    # Set multiprocessing start method to avoid import issues
    import multiprocessing
    try:
        multiprocessing.set_start_method('spawn', force=True)
    except RuntimeError:
        pass  # Already set
    
    import argparse
    
    parser = argparse.ArgumentParser(description='Evaluate the spacy classifier against ground truth CEFR ratings')
    parser.add_argument('--max-sentences', type=int, default=None, 
                        help='Maximum number of sentences to evaluate (default: all)')
    parser.add_argument('--test', action='store_true',
                        help='Test mode: evaluate only 100 sentences')
    
    args = parser.parse_args()
    
    # Path to the CEFR labeled sentences directory
    data_dir = Path(__file__).parent.parent.parent / "data" / "cefr_labeled_sentences"
    
    # Determine max_sentences
    if args.test:
        max_sentences = 100
        print("\n*** TEST MODE: Evaluating 100 sentences ***\n")
    else:
        max_sentences = args.max_sentences
    
    # Run evaluation
    evaluate_classifier(data_dir, max_sentences=max_sentences)

