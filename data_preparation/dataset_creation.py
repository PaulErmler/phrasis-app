import pandas as pd
import json
import numpy as np
from pathlib import Path
from tqdm import tqdm
from collections import defaultdict

# Import classifier
from language_intelligence.spacy_classifier import SentenceClassifier

# --- CONFIGURATION ---
# Define specific sampling constraints per difficulty level.
# 'default' is used if a difficulty level is not explicitly listed.
SAMPLING_CONFIG = {
    'default': {
        'min_max_rank': 0,
        'max_max_rank': 20000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 3000
    },
    'A1': {
        'min_max_rank': 185,
        'max_max_rank': 500,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 1000
    },
    'A2': {
        'min_max_rank': 200,
        'max_max_rank': 2000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 1500
    },
    'B1': {
        'min_max_rank': 300,
        'max_max_rank': 5000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 2500
    }, 
    'B2': {
        'min_max_rank': 500,
        'max_max_rank': 10000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 3000
    },
    'C1': {
        'min_max_rank': 5000,
        'max_max_rank': 10000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 5000
    },
    'C2': {
        'min_max_rank': 8000,
        'max_max_rank': 20000,
        'samples_per_max_rank': 3,
        'max_sentences_per_level': 5000
    },
    'Essential': {
        'min_max_rank': 0,
        'max_max_rank': 30000,
        'samples_per_max_rank': 1000,
        'max_sentences_per_level': 1000
    }
}

def main():
    """
    Refactored processing pipeline for sentences.
    - Reads classified sentences
    - Filters out flagged sentences
    - Calculates difficulty and max word rank for each
    - Samples based on rank distribution constraints
    - Saves results to CSV files
    """
    print("="*80)
    print("REFURBISHED SENTENCE PROCESSING PIPELINE")
    print("="*80)
    
    # Define paths
    base_dir = Path(__file__).parent
    input_file = base_dir / "data" / "intermediate_outputs" / "classified_sentences.csv"
    output_dir = base_dir / "data" / "output"
    final_output = output_dir / "sentences.csv"
    difficulty_dir = output_dir / "sentences_by_difficulty"
    
    # Create output directories
    difficulty_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Read input data
    print(f"\n[1/4] Reading input data from {input_file}")
    try:
        df = pd.read_csv(input_file, sep='\t')
    except Exception as e:
        print(f"   Error reading with tab separator: {e}. Trying comma...")
        df = pd.read_csv(input_file)
    print(f"   Loaded {len(df)} sentences")
    
    # Step 2: Filter out flagged sentences
    print(f"\n[2/4] Filtering out flagged sentences")
    # In classified_sentences.csv, flags are usually stored as '[]' or JSON strings
    df_unflagged = df[df['flags'] == '[]'].copy()
    flagged_count = len(df) - len(df_unflagged)
    
    print(f"   Flagged sentences removed: {flagged_count}")
    print(f"   Unflagged sentences remaining: {len(df_unflagged)}")
    
    # Step 3: Classify and calculate max word rank
    print(f"\n[3/4] Processing sentences (Difficulty + Max Word Rank)")
    classifier = SentenceClassifier()
    
    # 3a. Process Essential Sentences
    print("   - Processing Essential Sentences (Essential + A2)")
    a1_essentials_file = base_dir / "data" / "inputs" / "A1_essential_sentences.csv"
    a2_essentials_file = base_dir / "data" / "inputs" / "A2_essential_sentences.csv"
    
    essential_data = []
    current_id = 1
    
    def process_essentials(file_path, target_difficulty):
        nonlocal current_id
        if not file_path.exists():
            print(f"     ⚠ Essential file not found: {file_path.name}")
            return []
        
        # Read file (no header)
        ess_df = pd.read_csv(file_path, header=None, names=['text'])
        processed = []
        for _, row in ess_df.iterrows():
            text = str(row['text'])
            classifier.sentence(text)
            # Use fixed target difficulty but calculate actual max_rank
            max_rank = classifier.get_max_word_rank()
            processed.append({
                'id': current_id,
                'text': text,
                'difficulty': target_difficulty,
                'max_rank': max_rank,
                'topics': '',
                'is_essential': True
            })
            current_id += 1
        return processed

    a1_essentials = process_essentials(a1_essentials_file, 'Essential')
    a2_essentials = process_essentials(a2_essentials_file, 'A2')
    print(f"     ✓ Processed {len(a1_essentials)} Essential and {len(a2_essentials)} A2 essential sentences")

    # 3b. Process Main Dataset
    processed_data = []
    error_count = 0
    
    # Process sentences
    for _, row in tqdm(df_unflagged.iterrows(), total=len(df_unflagged), desc="   Analyzing main dataset", ncols=100):
        text = str(row['text'])
        try:
            classifier.sentence(text)
            difficulty = classifier.sentence_difficulty()
            max_rank = classifier.get_max_word_rank()
            
            processed_data.append({
                'id': row['id'],
                'text': text,
                'difficulty': difficulty,
                'max_rank': max_rank,
                'topics': '',
                'is_essential': False
            })
        except Exception as e:
            error_count += 1
            if error_count <= 5:
                print(f"\n   Error processing: {text[:50]}... -> {e}")
    
    df_processed = pd.DataFrame(processed_data)
    # Combine with essential sentences (we handle insertion logic during sampling)
    df_essentials = pd.DataFrame(a1_essentials + a2_essentials)
    
    print(f"   ✓ Analyzed {len(df_processed)} main sentences")
    if error_count > 0:
        print(f"   ⚠ {error_count} errors encountered")

    # Step 4: Sample sentences by difficulty level based on constraints
    print(f"\n[4/4] Sampling sentences with difficulty-specific constraints")
    
    unique_levels = sorted(df_processed['difficulty'].unique())
    # Add 'Essential' level if we have Essential sentences
    if len(a1_essentials) > 0 and 'Essential' not in unique_levels:
        unique_levels.append('Essential')
        unique_levels = sorted(unique_levels)
    all_sampled_dfs = []
    
    for level in unique_levels:
        df_level_main = df_processed[df_processed['difficulty'] == level].copy()
        df_level_ess = df_essentials[df_essentials['difficulty'] == level].copy()
        
        # Get configuration for this level or use default
        config = SAMPLING_CONFIG.get(level, SAMPLING_CONFIG['default'])
        max_target = config['max_sentences_per_level']
        
        # Filter main pool by rank range
        df_level_main = df_level_main[
            (df_level_main['max_rank'] >= config['min_max_rank']) & 
            (df_level_main['max_rank'] <= config['max_max_rank'])
        ]
        
        # Adjust target size based on how many essential sentences we have
        remaining_target = max_target - len(df_level_ess)
        
        if remaining_target < 0:
            # If essentials already exceed limit, truncate them
            df_sampled_ess = df_level_ess.iloc[:max_target]
            df_sampled_main = pd.DataFrame()
            print(f"   {level}: Essential sentences ({len(df_level_ess)}) exceed max level size ({max_target}). Truncating essentials.")
        else:
            df_sampled_ess = df_level_ess
            # Sample from main pool
            if df_level_main.empty:
                df_sampled_main = pd.DataFrame()
            else:
                # Limit samples per rank value in main pool
                df_level_main = df_level_main.groupby('max_rank').apply(
                    lambda x: x.sample(n=min(len(x), config['samples_per_max_rank']), random_state=42)
                ).reset_index(drop=True)
                
                # Sample remaining amount from main pool
                if len(df_level_main) > remaining_target:
                    df_level_main = df_level_main.sort_values('max_rank')
                    indices = np.linspace(0, len(df_level_main) - 1, remaining_target, dtype=int)
                    df_sampled_main = df_level_main.iloc[indices].copy()
                else:
                    df_sampled_main = df_level_main.copy()

        # Combine logic specific to A2 and Essential
        if level == 'Essential':
            # Essential level only contains essential sentences, no main sentences
            df_sampled = df_sampled_ess.copy()
            print(f"   Essential: {len(df_sampled_ess)} essential sentences.")
        elif level == 'A2':
            # Mix A2 essentials into first 2000
            if len(df_sampled_main) > 2000:
                first_part = df_sampled_main.iloc[:2000]
                second_part = df_sampled_main.iloc[2000:]
                
                # Combine essentials with first 2000 and shuffle them together
                mixed_first = pd.concat([df_sampled_ess, first_part], ignore_index=True)
                mixed_first = mixed_first.sample(frac=1, random_state=42).reset_index(drop=True)
                
                df_sampled = pd.concat([mixed_first, second_part], ignore_index=True)
                print(f"   A2: Mixed {len(df_sampled_ess)} essential sentences into the first 2000 sentences.")
            else:
                # Just shuffle everything if main pool is small
                df_sampled = pd.concat([df_sampled_ess, df_sampled_main], ignore_index=True)
                df_sampled = df_sampled.sample(frac=1, random_state=42).reset_index(drop=True)
                print(f"   A2: Mixed {len(df_sampled_ess)} essential sentences into the full dataset (size < 2000).")
        else:
            # For other levels, just combine
            df_sampled = pd.concat([df_sampled_ess, df_sampled_main], ignore_index=True)

        # D. Apply local jitter (±15 positions) and add final order rank
        if not df_sampled.empty:
            # Normal jitter for all levels
            base_indices = np.arange(len(df_sampled))
            jitter = np.random.randint(-15, 16, size=len(df_sampled))
            df_sampled = df_sampled.copy()
            df_sampled['_jitter_idx'] = base_indices + jitter
            df_sampled = df_sampled.sort_values('_jitter_idx').reset_index(drop=True)
            df_sampled = df_sampled.drop(columns=['_jitter_idx'])
            
            # Add the 'rank' column which represents the final order in the file
            df_sampled['rank'] = df_sampled.index + 1
            print(f"   {level}: Applied positioning logic and assigned ranks.")
            
        all_sampled_dfs.append(df_sampled)
        
        # Save per-level CSV - Include the new rank column and remove helper is_essential
        level_output = difficulty_dir / f"{level}.csv"
        cols_to_save = ['id', 'text', 'difficulty', 'max_rank', 'rank', 'topics']
        df_sampled[cols_to_save].to_csv(level_output, index=False)
    
    if all_sampled_dfs:
        df_final = pd.concat(all_sampled_dfs, ignore_index=True)
        
        # Save combined output
        print(f"\n   Saving combined results to {final_output}")
        cols_to_save = ['id', 'text', 'difficulty', 'max_rank', 'rank', 'topics']
        df_final[cols_to_save].to_csv(final_output, index=False)
        print(f"   ✓ Total sampled across all levels: {len(df_final)}")
    else:
        print("\n   ⚠ No sentences were sampled!")

    print("\n" + "="*80)
    print("PROCESSING COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()
