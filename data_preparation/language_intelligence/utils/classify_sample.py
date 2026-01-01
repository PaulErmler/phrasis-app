import sys
import pandas as pd
from pathlib import Path
from tqdm import tqdm
from collections import defaultdict

# Add parent directory to path to import spacy_classifier
utils_dir = Path(__file__).parent
lang_intel_dir = utils_dir.parent
sys.path.append(str(lang_intel_dir))

from spacy_classifier import SentenceClassifier

def main():
    # Paths
    base_dir = lang_intel_dir.parent
    input_csv = base_dir / "data" / "intermediate_outputs" / "classified_sentences.csv"
    output_txt = utils_dir / "output" / "sample_difficulty_ranking.txt"
    
    # Ensure output directory exists
    output_txt.parent.mkdir(parents=True, exist_ok=True)
    
    print(f"Reading data from {input_csv}...")
    try:
        # The file seems to be tab-separated based on initial inspection
        df = pd.read_csv(input_csv, sep='\t')
    except Exception as e:
        print(f"Error reading with tab separator: {e}")
        print("Trying with comma separator...")
        df = pd.read_csv(input_csv)

    print(f"Total sentences available: {len(df)}")
    
    # Filter out flagged sentences
    if 'flags' in df.columns:
        initial_count = len(df)
        df = df[df['flags'] == '[]']
        filtered_count = initial_count - len(df)
        print(f"Filtered out {filtered_count} flagged sentences. {len(df)} sentences remaining.")
    
    # Take a sample of 1000 sentences
    sample_size = min(10000, len(df))
    df_sample = df.sample(n=sample_size, random_state=42)
    
    print(f"Classifying {sample_size} sentences...")
    classifier = SentenceClassifier()
    
    results = defaultdict(list)
    
    for _, row in tqdm(df_sample.iterrows(), total=sample_size):
        text = str(row['text'])
        usefulness = row.get('usefulness', 'N/A')
        
        classifier.sentence(text)
        difficulty = classifier.sentence_difficulty()
        max_rank = classifier.get_max_word_rank()
        
        results[difficulty].append({
            'text': text,
            'usefulness': usefulness,
            'max_rank': max_rank
        })
    
    # Sort levels
    cefr_levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    
    print(f"Saving results to {output_txt}...")
    with open(output_txt, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write(f"{'SENTENCE DIFFICULTY RANKING (SAMPLE OF ' + str(sample_size) + ')':^80}\n")
        f.write("=" * 80 + "\n\n")
        
        for level in cefr_levels:
            sentences = results.get(level, [])
            # Sort by max word rank ascending
            sentences.sort(key=lambda x: x['max_rank'], reverse=False)
                
            f.write(f"--- LEVEL {level} ({len(sentences)} sentences) ---\n")
            f.write("-" * 40 + "\n")
            
            if not sentences:
                f.write("No sentences found for this level.\n")
            else:
                for i, item in enumerate(sentences, 1):
                    f.write(f"{i:3}. [Max Rank: {item['max_rank']:7.1f}] {item['text']}\n")
            
            f.write("\n" + "=" * 80 + "\n\n")

    print("Done!")

if __name__ == "__main__":
    main()

