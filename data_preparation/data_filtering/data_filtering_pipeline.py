#!/usr/bin/env python3
"""
Data filtering pipeline for Cacatua app.
"""

from pathlib import Path
from utils.read_tatoeba_dataset import read_tatoeba_dataset
from utils.filter_sentences import filter_sentences, filter_by_moderation, filter_by_name_limits
from utils.gemini_filter import SentenceProcessor


def main():
    """Main pipeline function."""
    pipeline_dir = Path(__file__).parent
    data_dir = pipeline_dir.parent / "data"
    output_path = data_dir / "intermediate_outputs"
    
    print("=" * 60)
    print("Cacatua Data Filtering Pipeline")
    print("=" * 60)
    print()
    
    # # Step 1: Extract and deduplicate English sentences from Tatoeba dataset
    # print("Step 1: Extracting English sentences from Tatoeba dataset...")
    # read_tatoeba_dataset(data_dir=str(data_dir))
    # print()
    
    # # Step 2: Filter the data
    # print("Step 2: Filtering the data...")
    # filter_sentences(data_dir=str(data_dir))
    # print()

    # # Step 2b: Filter by name limits (before random sampling)
    # print("Step 2b: Filtering by name limits...")
    # filter_by_name_limits(
    #     input_file=output_path / "filtered_length_banned.csv",
    #     output_file=output_path / "name_filtered_sentences.csv",
    #     filtered_output_file=output_path / "filtered_out_sentences.csv",
    #     limited_names=["Tom", "Mary", "John", "Ziri", "Stefan", "Paul", "William", "Muriel", "Rami", "Layla", "Rodrigo", "Gabriel", "Sandra", "Flavio", "Skura", "Matthew", "Boris"],
    #     name_limit_percent=0.6,  # 0.6% per name (based on entire dataset size)
    #     seed=42,  # For reproducibility
    #     data_dir=str(data_dir),
    # )
    # print()

    # print("Step 2c & 3: Moderate and classify in parallel...")
    # processor = SentenceProcessor()
    # processor.moderate_and_classify(
    #     input_file=output_path / "name_filtered_sentences.csv",
    #     moderated_output_file=output_path / "moderation_filtered_sentences.csv",
    #     classified_output_file=output_path / "classified_sentences.csv",
    #     filtered_output_file=output_path / "filtered_out_sentences.csv",
    #     data_dir=str(data_dir),
    #     max_classify=200000,
    # )
    # print()

    # Step 2c: Filter by moderation
    # print("Step 2c: Filtering by moderation...")
    # filter_by_moderation(
    #     input_file=output_path / "name_filtered_sentences.csv",
    #     output_file=output_path / "moderation_filtered_sentences.csv",
    #     filtered_output_file=output_path / "filtered_out_sentences.csv",
    #     data_dir=str(data_dir),
    # )
    # print()
    

    # # Step 4: Filter sentences using Gemini 2.5 Flash Lite 
    print("Step 3: Classifying sentences with LLM...")
    processor = SentenceProcessor()
    processor.classify(
        input_file=output_path / "moderation_filtered_sentences.csv",
        output_file=output_path / "classified_sentences.csv",
        data_dir=str(data_dir),
        max_sentences=100000,
    )
    print()
    
    print("Pipeline completed!")


if __name__ == "__main__":
    main()
