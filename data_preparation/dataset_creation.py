import pandas as pd
import json
from pathlib import Path
from collections import Counter
import matplotlib.pyplot as plt
import seaborn as sns
from tqdm import tqdm
import time

# Import classifiers
from language_intelligence.spacy_classifier import SentenceClassifier

def main(batch_size=30):
    """
    Main processing pipeline for sentences.
    
    Args:
        batch_size: Number of sentences to process per batch (default: 30)
    """
    print("="*80)
    print("SENTENCE PROCESSING PIPELINE")
    print("="*80)
    print(f"Configuration: Batch size = {batch_size}")
    
    # Define paths
    base_dir = Path(__file__).parent
    input_file = base_dir / "data" / "intermediate_outputs" / "classified_sentences.csv"
    flagged_output = base_dir / "data" / "intermediate_outputs" / "gemini_flagged_sentences.csv"
    topics_cache = base_dir / "data" / "intermediate_outputs" / "sentences_with_topics.csv"
    final_output = base_dir / "data" / "output" / "sentences.csv"
    stats_dir = base_dir / "data" / "output" / "dataset_statistics"
    difficulty_dir = base_dir / "data" / "output" / "sentences_by_difficulty"
    
    # Create output directories
    stats_dir.mkdir(parents=True, exist_ok=True)
    difficulty_dir.mkdir(parents=True, exist_ok=True)
    final_output.parent.mkdir(parents=True, exist_ok=True)
    flagged_output.parent.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Read input data
    print(f"\n[1/6] Reading input data from {input_file}")
    df = pd.read_csv(input_file, sep='\t')
    print(f"   Loaded {len(df)} sentences")
    
    # Step 2: Filter by flags
    print(f"\n[2/6] Filtering sentences by flags")
    # Parse flags column (it's a JSON string)
    df['flags_parsed'] = df['flags'].apply(lambda x: json.loads(x) if x != '[]' else [])
    df['has_flags'] = df['flags_parsed'].apply(lambda x: len(x) > 0)
    
    # Separate flagged and unflagged sentences
    df_flagged = df[df['has_flags']].copy()
    df_unflagged = df[~df['has_flags']].copy()
    
    print(f"   Flagged sentences: {len(df_flagged)}")
    print(f"   Unflagged sentences: {len(df_unflagged)}")
    
    # Save flagged sentences
    df_flagged[['id', 'text', 'usefulness', 'flags']].to_csv(flagged_output, sep='\t', index=False)
    print(f"   Saved flagged sentences to {flagged_output}")
    
    # Step 3: Assign difficulty levels
    print(f"\n[3/6] Assigning difficulty levels using spaCy classifier")
    classifier = SentenceClassifier()
    
    difficulties = []
    error_count = 0
    
    for _, row in tqdm(df_unflagged.iterrows(), total=len(df_unflagged), desc="   Difficulty classification"):
        text = row['text']
        try:
            difficulty = classifier.sentence(text).sentence_difficulty()
            difficulties.append(difficulty)
        except Exception as e:
            error_count += 1
            if error_count <= 5:  # Only print first 5 errors
                print(f"\n   Error processing sentence '{text[:50]}...': {e}")
            difficulties.append('C2')  # Default to C2 on error
    
    df_unflagged['difficulty'] = difficulties
    print(f"   ✓ Assigned difficulty levels to {len(df_unflagged)} sentences")
    if error_count > 0:
        print(f"   ⚠ {error_count} errors encountered (defaulted to C2)")
    
    # Step 4: Sample sentences by difficulty level
    print(f"\n[4/6] Sampling sentences by difficulty level (up to 200 per level)")
    
    sampled_dfs = []
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        df_level = df_unflagged[df_unflagged['difficulty'] == level]
        if len(df_level) > 200:
            df_sampled = df_level.sample(n=200, random_state=42)
            print(f"   {level}: Sampled 200 from {len(df_level)} sentences")
        else:
            df_sampled = df_level
            print(f"   {level}: Using all {len(df_level)} sentences")
        sampled_dfs.append(df_sampled)
    
    df_sampled = pd.concat(sampled_dfs, ignore_index=False)
    print(f"   ✓ Total sampled: {len(df_sampled)} sentences")
    
    # Step 5: Assign topics to sampled sentences using multi-pass batch processing
    print(f"\n[5/6] Assigning topics to sampled sentences using LLM classifier")
    
    from language_intelligence.llm_classifier import BatchTopicClassifier
    
    classifier = BatchTopicClassifier(
        batch_size=batch_size,
        cache_path=topics_cache,
        max_passes=3
    )
    df_sampled = classifier.classify_dataframe(df_sampled)
    
    # Step 6: Sort and save results
    print(f"\n[6/6] Sorting and saving results")
    
    # Sort by difficulty (A1 -> C2) then by llm_usefulness (high to low)
    difficulty_order = {'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6}
    df_sampled['difficulty_sort'] = df_sampled['difficulty'].map(difficulty_order)
    df_sampled = df_sampled.sort_values(
        by=['difficulty_sort', 'llm_usefulness'],
        ascending=[True, False]
    )
    df_sampled = df_sampled.drop('difficulty_sort', axis=1)
    print(f"   ✓ Sorted by difficulty (A1→C2) and LLM usefulness (high→low)")
    
    df_sampled[['id', 'text', 'difficulty', 'topics', 'llm_usefulness', 'usefulness']].to_csv(
        final_output, index=False
    )
    print(f"   ✓ Saved final dataset to {final_output}")
    
    # Save sentences by difficulty level
    print(f"\n   Saving sentences by difficulty level to {difficulty_dir}")
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        df_level = df_sampled[df_sampled['difficulty'] == level]
        if len(df_level) > 0:
            # Sort by LLM usefulness within each difficulty level
            df_level = df_level.sort_values('llm_usefulness', ascending=False)
            output_file = difficulty_dir / f"{level}.csv"
            df_level[['id', 'text', 'difficulty', 'topics', 'llm_usefulness', 'usefulness']].to_csv(
                output_file, index=False
            )
            print(f"      {level}: {len(df_level)} sentences saved to {level}.csv (sorted by usefulness)")
        else:
            print(f"      {level}: No sentences found")
    
    # Generate statistics
    print(f"\n[STATS] Generating dataset statistics")
    
    # Difficulty distribution
    difficulty_counts = Counter(df_sampled['difficulty'])
    difficulty_df = pd.DataFrame([
        {'difficulty': k, 'count': v, 'percentage': v/len(df_sampled)*100}
        for k, v in sorted(difficulty_counts.items())
    ])
    difficulty_df.to_csv(stats_dir / 'difficulty_distribution.csv', index=False)
    print(f"   Difficulty distribution:")
    for _, row in difficulty_df.iterrows():
        print(f"      {row['difficulty']}: {row['count']} ({row['percentage']:.1f}%)")
    
    # Topic distribution
    all_topic_list = []
    for topics_str in df_sampled['topics']:
        if topics_str:
            all_topic_list.extend(topics_str.split(','))
    
    topic_counts = Counter(all_topic_list)
    topic_df = pd.DataFrame([
        {'topic': k, 'count': v, 'percentage': v/len(all_topic_list)*100}
        for k, v in topic_counts.most_common()
    ])
    topic_df.to_csv(stats_dir / 'topic_distribution.csv', index=False)
    print(f"   Topic distribution:")
    for _, row in topic_df.head(10).iterrows():
        print(f"      {row['topic']}: {row['count']} ({row['percentage']:.1f}%)")
    
    # Create visualization plots
    print(f"\n[PLOTS] Creating visualization plots")
    
    # Difficulty distribution plot
    plt.figure(figsize=(10, 6))
    sns.barplot(data=difficulty_df, x='difficulty', y='count')
    plt.title('Difficulty Level Distribution')
    plt.xlabel('CEFR Level')
    plt.ylabel('Number of Sentences')
    plt.tight_layout()
    plt.savefig(stats_dir / 'difficulty_distribution.png', dpi=300)
    print(f"   Saved difficulty plot")
    
    # Topic distribution plot (top 15)
    plt.figure(figsize=(12, 6))
    sns.barplot(data=topic_df.head(15), x='topic', y='count')
    plt.title('Topic Distribution (Top 15)')
    plt.xlabel('Topic')
    plt.ylabel('Number of Occurrences')
    plt.xticks(rotation=45, ha='right')
    plt.tight_layout()
    plt.savefig(stats_dir / 'topic_distribution.png', dpi=300)
    print(f"   Saved topic plot")
    
    # Summary statistics
    summary = {
        'total_sentences': len(df),
        'flagged_sentences': len(df_flagged),
        'unflagged_sentences': len(df_unflagged),
        'sampled_sentences': len(df_sampled),
        'total_unique_topics': len(topic_counts),
        'avg_topics_per_sentence': len(all_topic_list) / len(df_sampled) if len(df_sampled) > 0 else 0,
        'avg_original_usefulness': df_sampled['usefulness'].mean(),
        'avg_llm_usefulness': df_sampled['llm_usefulness'].mean(),
        'median_original_usefulness': df_sampled['usefulness'].median(),
        'median_llm_usefulness': df_sampled['llm_usefulness'].median(),
    }
    
    # Save usefulness comparison
    usefulness_comparison = pd.DataFrame({
        'original_usefulness': df_sampled['usefulness'],
        'llm_usefulness': df_sampled['llm_usefulness']
    })
    usefulness_comparison.to_csv(stats_dir / 'usefulness_comparison.csv', index=False)
    
    with open(stats_dir / 'summary.txt', 'w') as f:
        f.write("DATASET SUMMARY\n")
        f.write("="*80 + "\n\n")
        for key, value in summary.items():
            if isinstance(value, float):
                f.write(f"{key}: {value:.2f}\n")
            else:
                f.write(f"{key}: {value}\n")
        f.write("\n\nDIFFICULTY DISTRIBUTION\n")
        f.write("-"*80 + "\n")
        f.write(difficulty_df.to_string(index=False))
        f.write("\n\n\nTOPIC DISTRIBUTION\n")
        f.write("-"*80 + "\n")
        f.write(topic_df.to_string(index=False))
        f.write("\n\n\nUSEFULNESS SCORES\n")
        f.write("-"*80 + "\n")
        f.write(f"Original Usefulness - Mean: {summary['avg_original_usefulness']:.2f}, Median: {summary['median_original_usefulness']:.2f}\n")
        f.write(f"LLM Usefulness - Mean: {summary['avg_llm_usefulness']:.2f}, Median: {summary['median_llm_usefulness']:.2f}\n")
    
    # Create usefulness comparison plot
    plt.figure(figsize=(12, 5))
    
    plt.subplot(1, 2, 1)
    plt.hist(df_sampled['usefulness'].dropna(), bins=20, alpha=0.7, label='Original', edgecolor='black')
    plt.xlabel('Usefulness Score')
    plt.ylabel('Frequency')
    plt.title('Original Usefulness Distribution')
    plt.legend()
    
    plt.subplot(1, 2, 2)
    plt.hist(df_sampled['llm_usefulness'].dropna(), bins=20, alpha=0.7, label='LLM', color='orange', edgecolor='black')
    plt.xlabel('Usefulness Score')
    plt.ylabel('Frequency')
    plt.title('LLM Usefulness Distribution')
    plt.legend()
    
    plt.tight_layout()
    plt.savefig(stats_dir / 'usefulness_comparison.png', dpi=300)
    print(f"   Saved usefulness comparison plot")
    
    print(f"   Saved summary statistics")
    
    print("\n" + "="*80)
    print("PROCESSING COMPLETE")
    print("="*80)
    print(f"\nOutputs:")
    print(f"  - Final dataset: {final_output}")
    print(f"  - Flagged sentences: {flagged_output}")
    print(f"  - Sentences by difficulty: {difficulty_dir}")
    print(f"  - Statistics directory: {stats_dir}")
    print(f"  - Topic cache: {topics_cache}")
    print(f"\n💡 Tip: Delete {topics_cache} to regenerate topics")
    print()

if __name__ == "__main__":
    import sys
    
    # Allow batch size to be specified as command line argument
    batch_size = 30
    
    if len(sys.argv) > 1:
        try:
            batch_size = int(sys.argv[1])
            print(f"Using custom batch size: {batch_size}")
        except ValueError:
            print(f"Invalid batch size '{sys.argv[1]}', using default: 30")
    
    main(batch_size=batch_size)
