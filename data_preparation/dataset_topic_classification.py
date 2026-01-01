import pandas as pd
from pathlib import Path
import sys
import os

# Add the project root to the path so we can import our modules
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

from data_preparation.language_intelligence.llm_classifier import BatchTopicClassifier

def propagate_topics(df, sentences_path, difficulty_dir):
    """
    Saves the main sentences.csv and updates all difficulty-specific CSV files.
    """
    print(f"\n[Propagating Topics]")
    
    # Prepare a clean version for output files (replace placeholder "none" with "")
    clean_df = df.copy()
    if 'topics' in clean_df.columns:
        clean_df['topics'] = clean_df['topics'].replace('none', '')
        
    # Save the updated main sentences file
    print(f"  → Saving updated main file to {sentences_path}...")
    clean_df.to_csv(sentences_path, index=False)
    
    # Update difficulty files
    if difficulty_dir.exists():
        for diff_file in difficulty_dir.glob("*.csv"):
            print(f"  → Updating {diff_file.name}...")
            diff_df = pd.read_csv(diff_file)
            
            # Drop topics if it already exists to avoid duplicates during merge
            if 'topics' in diff_df.columns:
                diff_df.drop(columns=['topics'], inplace=True)
            
            # Merge with the main clean_df to get topics
            updated_diff_df = diff_df.merge(
                clean_df[['id', 'topics']], 
                on='id', 
                how='left'
            )
            
            updated_diff_df.to_csv(diff_file, index=False)
            print(f"    ✓ {diff_file.name} updated.")
    print("[Propagation Complete]\n")

def main():
    # Define paths
    project_root = Path(__file__).parent.parent
    data_dir = project_root / "data_preparation" / "data" / "output"
    sentences_path = data_dir / "sentences.csv"
    difficulty_dir = data_dir / "sentences_by_difficulty"
    cache_path = data_dir / "sentences_with_topics_cache.tsv"
    
    if not sentences_path.exists():
        print(f"Error: {sentences_path} not found.")
        return

    print(f"Reading {sentences_path}...")
    df = pd.read_csv(sentences_path)
    
    # Check for existing cache at the start
    if cache_path.exists():
        print(f"✓ Found existing cache at {cache_path}. Propagating initial cached topics...")
        df_cached = pd.read_csv(cache_path, sep='\t')
        
        # Merge cached topics into df
        if 'topics' in df.columns:
            df = df.drop(columns=['topics'])
        df = df.merge(df_cached[['id', 'topics']], on='id', how='left')
        
        # Propagate initial state
        propagate_topics(df, sentences_path, difficulty_dir)
    
    # Initialize classifier with max_passes=3
    classifier = BatchTopicClassifier(batch_size=50, cache_path=cache_path, max_passes=3)
    
    print("Starting topic classification...")
    
    # Define callback for pass completion
    def on_pass_complete(current_df):
        propagate_topics(current_df, sentences_path, difficulty_dir)
    
    # Run classification with callback
    df = classifier.classify_dataframe(df, on_pass_complete=on_pass_complete)
    
    print("\n✓ Topic classification and propagation complete!")

if __name__ == "__main__":
    main()
