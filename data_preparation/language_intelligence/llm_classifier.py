from pydantic import BaseModel
from pydantic_ai import Agent
import pandas as pd
from pathlib import Path
from tqdm import tqdm
import time


class SentenceClassification(BaseModel):
    """Classification for a single sentence"""
    usefulness: float
    topics: list[str]


class SentenceTopics(BaseModel):
    """Topics and usefulness for a single sentence"""
    topics: list[str]
    usefulness: float


class BatchSentenceClassification(BaseModel):
    """Classification for a batch of sentences"""
    sentences: list[SentenceTopics]


# Topic list used across all classifiers
TOPIC_LIST = """
- food
- animals
- plants
- weather
- school
- time
- money
- travel
- emotions
- work
- sports
- music
- free time
- hobbies
- movies
- books
- language learning
- goals
- negation
- requests
- future plans
"""


# Single sentence agent (for individual fallback processing)
agent = Agent('openrouter:google/gemini-2.5-flash-lite', 
    output_type=SentenceClassification,
    system_prompt=f'''You are a language teacher. Analyze the following sentence and provide a usefulness score between 1 and 10. 
    Also provide a list of topics that the sentence may contain.
    Choose from the following list of topics: 
    {TOPIC_LIST}
    '''
)


class BatchTopicClassifier:
    """
    Efficient batch classifier for sentence topic assignment with multi-pass retry logic.
    
    Features:
    - Processes sentences in batches of 30 for efficiency
    - Multi-pass retry: failed batches are re-batched and retried up to 3 times
    - Intelligent alignment for off-by-one batch mismatches
    - Progress caching to resume from interruptions
    - Only falls back to individual processing after 3 failed passes
    """
    
    def __init__(self, batch_size: int = 30, cache_path: Path = None, max_passes: int = 3):
        """
        Initialize the batch classifier.
        
        Args:
            batch_size: Number of sentences per batch (default: 30)
            cache_path: Path to cache file for progress saving (optional)
            max_passes: Maximum number of batch passes before individual fallback (default: 3)
        """
        self.batch_size = batch_size
        self.cache_path = cache_path
        self.max_passes = max_passes
        self.error_count = 0
        
        # Create batch agent with improved prompt
        self.batch_agent = Agent(
            'openrouter:google/gemini-2.5-flash-lite',
            output_type=BatchSentenceClassification,
            system_prompt=f'''You are a language teacher. Analyze each sentence and provide:
            1. A usefulness score between 1 and 10 (how useful is this sentence for language learners)
            2. A list of topics it contains
            
            Choose ONLY from the following topics: 
            {TOPIC_LIST}
            
            CRITICAL: You MUST return exactly the same number of results as sentences provided.
            Return the usefulness and topics for each sentence in the EXACT same order they were provided.
            If a sentence doesn't clearly match any topics, return an empty list for that sentence.
            DO NOT skip sentences. DO NOT merge sentences. Process each one individually.
            '''
        )
    
    def _classify_single_batch(self, sentences: list[str], batch_indices: list[int]) -> tuple[dict, list[int]]:
        """
        Process one batch of sentences.
        
        Args:
            sentences: List of sentence strings to classify
            batch_indices: Original dataframe indices for these sentences
            
        Returns:
            (results_dict, failed_indices) where:
                - results_dict maps index -> {'topics': str, 'usefulness': float}
                - failed_indices lists indices that failed to process
        """
        # Create explicit indexed prompt
        batch_prompt = f"Process these {len(sentences)} sentences and return EXACTLY {len(sentences)} results:\n\n"
        for i, sent in enumerate(sentences):
            batch_prompt += f"Sentence {i}: \"{sent}\"\n"
        
        try:
            result = self.batch_agent.run_sync(batch_prompt)
            batch_results = result.output.sentences
            
            # Check if we got the right number of results
            if len(batch_results) == len(batch_indices):
                # Perfect match - process all results
                results_dict = {}
                for idx, result_obj in zip(batch_indices, batch_results):
                    topics_str = ','.join(str(t) for t in result_obj.topics) if result_obj.topics else ''
                    try:
                        usefulness_val = float(result_obj.usefulness)
                    except (ValueError, TypeError):
                        usefulness_val = None
                    
                    results_dict[idx] = {
                        'topics': topics_str,
                        'llm_usefulness': usefulness_val
                    }
                return results_dict, []
            
            # Count mismatch - try alignment if off by 1-2
            elif abs(len(batch_results) - len(batch_indices)) <= 2:
                # Attempt intelligent alignment
                results_dict = self._try_align_results(sentences, batch_indices, batch_results)
                if results_dict:
                    return results_dict, []
            
            # Alignment failed or too many mismatches - mark all as failed
            self.error_count += 1
            if self.error_count <= 5:
                tqdm.write(f"   ⚠ Batch error: Expected {len(batch_indices)} results but got {len(batch_results)}")
            return {}, batch_indices
            
        except Exception as e:
            self.error_count += 1
            if self.error_count <= 5:
                tqdm.write(f"   ⚠ Batch error: {str(e)[:150]}")
            return {}, batch_indices
    
    def _try_align_results(self, sentences: list[str], batch_indices: list[int], 
                          batch_results: list[SentenceTopics]) -> dict:
        """
        Try to align mismatched batch results with original sentences.
        
        Returns results_dict if successful, None if alignment fails.
        """
        # For now, return None (alignment failed)
        # Could implement fuzzy matching here in the future
        return None
    
    def _process_pass(self, sentences_to_process: list[tuple[int, str]], pass_num: int) -> tuple[dict, list[tuple[int, str]]]:
        """
        Process one complete pass over sentences.
        
        Args:
            sentences_to_process: List of (index, sentence_text) tuples
            pass_num: Current pass number (for logging)
            
        Returns:
            (successful_results_dict, failed_sentences_list)
        """
        results_dict = {}
        failed_sentences = []
        
        total_batches = (len(sentences_to_process) + self.batch_size - 1) // self.batch_size
        
        with tqdm(total=len(sentences_to_process), 
                 desc=f"   Pass {pass_num}", 
                 unit="sent",
                 bar_format='{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}]') as pbar:
            
            for batch_start in range(0, len(sentences_to_process), self.batch_size):
                batch_end = min(batch_start + self.batch_size, len(sentences_to_process))
                batch_items = sentences_to_process[batch_start:batch_end]
                
                batch_indices = [idx for idx, _ in batch_items]
                batch_sentences = [text for _, text in batch_items]
                
                # Process this batch
                batch_results, batch_failed = self._classify_single_batch(batch_sentences, batch_indices)
                
                # Add successful results
                results_dict.update(batch_results)
                
                # Collect failed sentences for retry
                for idx in batch_failed:
                    # Find the sentence text
                    for item_idx, item_text in batch_items:
                        if item_idx == idx:
                            failed_sentences.append((idx, item_text))
                            break
                
                pbar.update(len(batch_items))
        
        return results_dict, failed_sentences
    
    def _process_individual(self, sentences_to_process: list[tuple[int, str]]) -> dict:
        """
        Process sentences individually (final fallback).
        
        Args:
            sentences_to_process: List of (index, sentence_text) tuples
            
        Returns:
            results_dict mapping index -> {'topics': str, 'usefulness': float}
        """
        results_dict = {}
        
        with tqdm(total=len(sentences_to_process), 
                 desc="   Individual processing", 
                 unit="sent",
                 bar_format='{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]') as pbar:
            
            for idx, text in sentences_to_process:
                try:
                    result = agent.run_sync(text)
                    
                    topics_str = ','.join(str(t) for t in result.output.topics) if result.output.topics else ''
                    try:
                        usefulness_val = float(result.output.usefulness)
                    except (ValueError, TypeError):
                        usefulness_val = None
                    
                    results_dict[idx] = {
                        'topics': topics_str,
                        'llm_usefulness': usefulness_val
                    }
                except Exception as e:
                    self.error_count += 1
                    if self.error_count <= 5:
                        tqdm.write(f"   ⚠ Individual error: {str(e)[:100]}")
                    # Mark as empty
                    results_dict[idx] = {
                        'topics': '',
                        'llm_usefulness': None
                    }
                
                pbar.update(1)
        
        return results_dict
    
    def classify_dataframe(self, df: pd.DataFrame, text_column: str = 'text') -> pd.DataFrame:
        """
        Main entry point: Classify all sentences in a dataframe using multi-pass batch processing.
        
        Args:
            df: DataFrame containing sentences to classify
            text_column: Name of column containing sentence text (default: 'text')
            
        Returns:
            DataFrame with added 'topics' and 'llm_usefulness' columns
        """
        # Check for existing cache and load it
        if self.cache_path and self.cache_path.exists():
            print(f"   ✓ Found cached topics at {self.cache_path}")
            df_cached = pd.read_csv(self.cache_path, sep='\t')
            
            # Merge to get already processed topics and llm_usefulness
            merge_cols = ['id', 'topics', 'llm_usefulness']
            if 'difficulty' in df_cached.columns:
                merge_cols.append('difficulty')
            
            df = df.merge(
                df_cached[merge_cols],
                on='id',
                how='left',
                suffixes=('', '_cached')
            )
            
            # Use cached difficulty if available
            if 'difficulty_cached' in df.columns:
                df['difficulty'] = df['difficulty_cached'].fillna(df['difficulty'])
                df.drop('difficulty_cached', axis=1, inplace=True)
            
            already_processed = df['topics'].notna().sum()
            print(f"   ✓ Found {already_processed} sentences with existing topics")
        else:
            df['topics'] = None
            df['llm_usefulness'] = None
            already_processed = 0
        
        # Find sentences that need processing
        needs_processing = df['topics'].isna()
        num_to_process = needs_processing.sum()
        
        if num_to_process == 0:
            print(f"   ✓ All sentences already have topics assigned!")
            return df
        
        print(f"   → Need to process {num_to_process} sentences ({num_to_process / len(df) * 100:.1f}%)")
        print(f"   → Batch size: {self.batch_size}, Max passes: {self.max_passes}")
        
        # Prepare list of sentences to process
        sentences_to_process = [
            (idx, row[text_column])
            for idx, row in df[needs_processing].iterrows()
        ]
        
        start_time = time.time()
        all_results = {}
        
        # Multi-pass processing
        for pass_num in range(1, self.max_passes + 1):
            if not sentences_to_process:
                break
            
            print(f"\n   Pass {pass_num}: Processing {len(sentences_to_process)} sentences in {(len(sentences_to_process) + self.batch_size - 1) // self.batch_size} batches")
            
            pass_results, failed_sentences = self._process_pass(sentences_to_process, pass_num)
            
            # Add results from this pass
            all_results.update(pass_results)
            
            # Update dataframe with current progress
            for idx, result in pass_results.items():
                df.at[idx, 'topics'] = result['topics']
                df.at[idx, 'llm_usefulness'] = result['llm_usefulness']
            
            # Save progress
            if self.cache_path:
                save_df = df[['id', 'text', 'difficulty', 'topics', 'llm_usefulness', 'usefulness', 'flags']].copy()
                save_df['topics'] = save_df['topics'].fillna('').astype(str)
                save_df['llm_usefulness'] = pd.to_numeric(save_df['llm_usefulness'], errors='coerce')
                save_df.to_csv(self.cache_path, sep='\t', index=False)
            
            success_count = len(pass_results)
            fail_count = len(failed_sentences)
            success_rate = (success_count / (success_count + fail_count) * 100) if (success_count + fail_count) > 0 else 0
            
            print(f"   ✓ Pass {pass_num} complete: {success_count} succeeded, {fail_count} failed (success rate: {success_rate:.1f}%)")
            
            # Prepare for next pass
            sentences_to_process = failed_sentences
        
        # Final individual processing for any remaining failures
        if sentences_to_process:
            print(f"\n   → {len(sentences_to_process)} sentences still need processing, using individual fallback")
            individual_results = self._process_individual(sentences_to_process)
            
            # Add individual results
            all_results.update(individual_results)
            
            # Update dataframe
            for idx, result in individual_results.items():
                df.at[idx, 'topics'] = result['topics']
                df.at[idx, 'llm_usefulness'] = result['llm_usefulness']
            
            # Save final progress
            if self.cache_path:
                save_df = df[['id', 'text', 'difficulty', 'topics', 'llm_usefulness', 'usefulness', 'flags']].copy()
                save_df['topics'] = save_df['topics'].fillna('').astype(str)
                save_df['llm_usefulness'] = pd.to_numeric(save_df['llm_usefulness'], errors='coerce')
                save_df.to_csv(self.cache_path, sep='\t', index=False)
        
        elapsed = time.time() - start_time
        rate = num_to_process / elapsed if elapsed > 0 else 0
        
        print(f"\n   ✓ Assigned topics to {num_to_process} sentences")
        print(f"   ✓ Processing rate: {rate:.1f} sentences/sec")
        if self.error_count > 0:
            print(f"   ⚠ {self.error_count} errors encountered (topics left empty)")
        if self.cache_path:
            print(f"   ✓ Final cache saved to {self.cache_path}")
        
        return df