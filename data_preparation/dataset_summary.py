import pandas as pd
from pathlib import Path
from collections import Counter

def main():
    # Define paths
    project_root = Path(__file__).parent.parent
    data_dir = project_root / "data_preparation" / "data" / "output"
    sentences_path = data_dir / "sentences.csv"
    stats_dir = data_dir / "dataset_statistics"
    output_path = stats_dir / "dataset_summary_new.txt"
    
    # Ensure stats directory exists
    stats_dir.mkdir(parents=True, exist_ok=True)
    
    if not sentences_path.exists():
        print(f"Error: {sentences_path} not found.")
        return

    print(f"Reading {sentences_path}...")
    df = pd.read_csv(sentences_path)
    
    # Ensure topics is a string and handle empty/placeholder values
    df['topics'] = df['topics'].fillna('').astype(str).replace('none', '')
    
    # 1. Number of cards per difficulty
    difficulty_counts = df['difficulty'].value_counts().sort_index()
    
    # 2. Distribution of topics
    all_topics = []
    for t_str in df['topics']:
        if t_str:
            all_topics.extend([t.strip() for t in t_str.split(',') if t.strip()])
    
    topic_counts = Counter(all_topics)
    topic_distribution = pd.Series(topic_counts).sort_values(ascending=False)
    
    # 3. Distribution of topics across difficulties
    # Create a long-form dataframe for topics
    topic_difficulty_data = []
    for _, row in df.iterrows():
        if row['topics']:
            topics = [t.strip() for t in row['topics'].split(',') if t.strip()]
            for topic in topics:
                topic_difficulty_data.append({
                    'topic': topic,
                    'difficulty': row['difficulty']
                })
    
    topic_diff_df = pd.DataFrame(topic_difficulty_data)
    if not topic_diff_df.empty:
        topic_dist_across_diff = pd.crosstab(topic_diff_df['topic'], topic_diff_df['difficulty'])
    else:
        topic_dist_across_diff = pd.DataFrame()

    # 4. Characters overall
    total_characters = df['text'].str.len().sum()
    
    # 5. Average characters per sentence
    avg_characters = df['text'].str.len().mean()
    
    # Write summary to file
    print(f"Writing summary to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("PHRASIS DATASET SUMMARY\n")
        f.write("=" * 60 + "\n\n")
        
        f.write("OVERALL STATISTICS\n")
        f.write("-" * 30 + "\n")
        f.write(f"Total Sentences: {len(df):,}\n")
        f.write(f"Total Characters: {int(total_characters):,}\n")
        f.write(f"Avg Characters per Sentence: {avg_characters:.2f}\n\n")
        
        f.write("CARDS PER DIFFICULTY\n")
        f.write("-" * 30 + "\n")
        for diff, count in difficulty_counts.items():
            percentage = (count / len(df)) * 100
            f.write(f"{diff}: {count:,} ({percentage:.1f}%)\n")
        f.write("\n")
        
        f.write("TOPIC DISTRIBUTION (Overall)\n")
        f.write("-" * 30 + "\n")
        if not topic_distribution.empty:
            for topic, count in topic_distribution.items():
                percentage = (count / len(all_topics)) * 100
                f.write(f"{topic:<25}: {count:,} ({percentage:.1f}% of all topic tags)\n")
        else:
            f.write("No topics assigned yet.\n")
        f.write("\n")
        
        f.write("TOPIC DISTRIBUTION ACROSS DIFFICULTIES\n")
        f.write("-" * 30 + "\n")
        if not topic_dist_across_diff.empty:
            # Sort by total count across all difficulties
            topic_totals = topic_dist_across_diff.sum(axis=1).sort_values(ascending=False)
            sorted_topic_dist = topic_dist_across_diff.loc[topic_totals.index]
            
            # Print header
            difficulties = sorted_topic_dist.columns.tolist()
            header = f"{'Topic':<25} | " + " | ".join([f"{d:>5}" for d in difficulties])
            f.write(header + "\n")
            f.write("-" * len(header) + "\n")
            
            for topic, row in sorted_topic_dist.iterrows():
                counts = " | ".join([f"{int(row[d]):>5}" for d in difficulties])
                f.write(f"{topic:<25} | {counts}\n")
        else:
            f.write("No topic data available for cross-difficulty analysis.\n")
            
    print("✓ Summary created successfully!")

if __name__ == "__main__":
    main()

