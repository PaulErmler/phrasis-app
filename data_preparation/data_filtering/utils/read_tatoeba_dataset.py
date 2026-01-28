#!/usr/bin/env python3
"""
Read Tatoeba dataset CSV, extract English sentences, deduplicate, and save to output CSV.
"""

import csv
from pathlib import Path
from collections import OrderedDict


def read_tatoeba_dataset(input_file: str = None, data_dir: str = None):
    """
    Read Tatoeba sentences CSV, extract English sentences, deduplicate, and save.
    
    Args:
        input_file: Path to the input sentences.csv file (optional, will use data_dir/sentences.csv if not provided)
        data_dir: Directory containing the data files (optional, will be inferred if not provided)
    """
    # Determine paths
    if data_dir is None:
        # Try to infer from input_file location, or use default
        if input_file:
            data_dir = str(Path(input_file).parent)
        else:
            # Default: assume script is in data_processing, data is in parent/data
            script_dir = Path(__file__).parent
            data_dir = str(script_dir.parent / "data")
    
    data_path = Path(data_dir)
    
    # Set input file if not provided
    if input_file is None:
        # Try inputs/sentences.csv first, then fall back to sentences.csv
        input_file_path = data_path / "inputs" / "sentences.csv"
        if not input_file_path.exists():
            input_file_path = data_path / "sentences.csv"
        input_file = str(input_file_path)
    
    # Check if input file exists
    if not Path(input_file).exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")
    
    # Output directory is inside the data folder
    output_path = data_path / "intermediate_outputs"
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Use OrderedDict to preserve insertion order while deduplicating
    unique_sentences = OrderedDict()
    
    print(f"Reading sentences from: {input_file}")
    
    # Read the CSV file (tab-separated)
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        
        for row_num, row in enumerate(reader, start=1):
            if len(row) < 3:
                continue  # Skip malformed rows
            
            sentence_id = row[0]
            language_code = row[1]
            sentence_text = row[2]
            
            # Filter for English sentences
            if language_code == 'eng':
                # Normalize whitespace and deduplicate based on text
                normalized_text = sentence_text.strip()
                
                # Only add if not already seen (case-sensitive deduplication)
                if normalized_text and normalized_text not in unique_sentences:
                    unique_sentences[normalized_text] = {
                        'id': sentence_id,
                        'language': language_code,
                        'text': normalized_text
                    }
            
            # Progress indicator for large files
            if row_num % 100000 == 0:
                print(f"Processed {row_num:,} rows, found {len(unique_sentences):,} unique English sentences...")
    
    print(f"\nTotal unique English sentences found: {len(unique_sentences):,}")
    
    # Write to output CSV
    output_file = output_path / "english_sentences.csv"
    
    print(f"Writing to: {output_file}")
    
    with open(output_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, delimiter='\t')
        
        # Write header
        writer.writerow(['id', 'language', 'text'])
        
        # Write all unique sentences
        for sentence_data in unique_sentences.values():
            writer.writerow([
                sentence_data['id'],
                sentence_data['language'],
                sentence_data['text']
            ])
    
    print(f"Successfully saved {len(unique_sentences):,} unique English sentences to {output_file}")


if __name__ == "__main__":
    # Get the path to the sentences.csv file
    script_dir = Path(__file__).parent
    data_dir = script_dir.parent / "data"
    
    read_tatoeba_dataset(data_dir=str(data_dir))

