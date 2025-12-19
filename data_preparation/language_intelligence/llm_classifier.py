from pydantic import BaseModel
from pydantic_ai import Agent
import pandas as pd
from pathlib import Path
from tqdm import tqdm
import time


class SentenceTopics(BaseModel):
    """Topics for a single sentence"""
    topics: list[str]


class BatchSentenceClassification(BaseModel):
    """Classification for a batch of sentences"""
    sentences: list[SentenceTopics]


# Topic list used across all classifiers
TOPIC_LIST = """
- greetings & introductions
- numbers & counting
- negation 
- personal pronouns
- colors & shapes
- days, months & seasons
- language learning
- future plans & goals
- animals 
- sports
- emotions
- plants
- telling time
- basic verbs & actions
- in the classroom
- at the restaurant
- shopping & prices
- asking for help
- directions & locations
- family & relationships
- likes & dislikes
- possession (my, your, his)
- polite requests & manners
"""


# Single sentence agent (for individual fallback processing)
agent = Agent('openrouter:google/gemini-2.5-flash-lite', 
    output_type=SentenceTopics,
    system_prompt=f'''You are a language teacher. Analyze the following sentence and provide a list of topics that the sentence contains.
    Choose ONLY from the following list of topics: 
    {TOPIC_LIST}
    
    If the sentence doesn't clearly match any topics, return an empty list.
    '''
)


class BatchTopicClassifier:
    """
    Efficient batch classifier for sentence topic assignment with multi-pass retry logic.
    """
    
    def __init__(self, batch_size: int = 30, cache_path: Path = None, max_passes: int = 3):
        """
        Initialize the batch classifier.
        """
        self.batch_size = batch_size
        self.cache_path = cache_path
        self.max_passes = max_passes
        self.error_count = 0
        
        # Create batch agent with improved prompt
        self.batch_agent = Agent(
            'openrouter:google/gemini-2.5-flash-lite',
            output_type=BatchSentenceClassification,
            system_prompt=f'''You are a language teacher. Analyze each sentence and provide a list of topics it contains.
            
            Choose ONLY from the following topics: 
            {TOPIC_LIST}
            
            CRITICAL: You MUST return exactly the same number of results as sentences provided.
            Return the topics for each sentence in the EXACT same order they were provided.
            If a sentence doesn't clearly match any topics, return an empty list for that sentence.
            DO NOT skip sentences. DO NOT merge sentences. Process each one individually.
            '''
        )
    
    def _classify_single_batch(self, sentences: list[str], batch_indices: list[int]) -> tuple[dict, list[int]]:
        """
        Process one batch of sentences.
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
                results_dict = {}
                for idx, result_obj in zip(batch_indices, batch_results):
                    # Use "none" as an explicit marker for processed sentences with no topics
                    # This prevents re-processing empty results due to CSV loading behavior
                    topics_str = ','.join(str(t) for t in result_obj.topics) if result_obj.topics else 'none'
                    results_dict[idx] = {'topics': topics_str}
                return results_dict, []
            
            self.error_count += 1
            if self.error_count <= 5:
                tqdm.write(f"   ⚠ Batch error: Expected {len(batch_indices)} results but got {len(batch_results)}")
            return {}, batch_indices
            
        except Exception as e:
            self.error_count += 1
            if self.error_count <= 5:
                tqdm.write(f"   ⚠ Batch error: {str(e)[:150]}")
            return {}, batch_indices
    
    def _process_pass(self, sentences_to_process: list[tuple[int, str]], pass_num: int, df: pd.DataFrame) -> list[tuple[int, str]]:
        """
        Process one complete pass over sentences.
        """
        failed_sentences = []
        
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
                
                # Update dataframe and save cache after each batch
                for idx, result in batch_results.items():
                    df.at[idx, 'topics'] = result['topics']
                
                if self.cache_path and batch_results:
                    df.to_csv(self.cache_path, sep='\t', index=False)
                
                # Collect failed sentences for retry
                for idx in batch_failed:
                    # Find the sentence text
                    for item_idx, item_text in batch_items:
                        if item_idx == idx:
                            failed_sentences.append((idx, item_text))
                            break
                
                pbar.update(len(batch_items))
        
        return failed_sentences
    
    def _process_individual(self, sentences_to_process: list[tuple[int, str]]) -> dict:
        """
        Process sentences individually (final fallback).
        """
        results_dict = {}
        
        with tqdm(total=len(sentences_to_process), 
                 desc="   Individual processing", 
                 unit="sent",
                 bar_format='{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]') as pbar:
            
            for idx, text in sentences_to_process:
                try:
                    result = agent.run_sync(text)
                    # Use "none" as explicit marker for no topics
                    topics_str = ','.join(str(t) for t in result.output.topics) if result.output.topics else 'none'
                    results_dict[idx] = {'topics': topics_str}
                except Exception as e:
                    self.error_count += 1
                    if self.error_count <= 5:
                        tqdm.write(f"   ⚠ Individual error: {str(e)[:100]}")
                    results_dict[idx] = {'topics': ''}
                
                pbar.update(1)
        
        return results_dict
    
    def classify_dataframe(self, df: pd.DataFrame, text_column: str = 'text', on_pass_complete=None) -> pd.DataFrame:
        """
        Main entry point: Classify all sentences in a dataframe.
        
        Args:
            df: DataFrame to classify
            text_column: Column containing sentence text
            on_pass_complete: Optional callback function called after each pass with the current df
        """
        # Check for existing cache and load it
        if self.cache_path and self.cache_path.exists():
            print(f"   ✓ Found cached topics at {self.cache_path}")
            df_cached = pd.read_csv(self.cache_path, sep='\t')
            
            # Merge to get already processed topics
            if 'topics' in df.columns:
                df = df.drop(columns=['topics'])
                
            df = df.merge(
                df_cached[['id', 'topics']],
                on='id',
                how='left'
            )
            
            already_processed = df['topics'].notna().sum()
            print(f"   ✓ Found {already_processed} sentences with existing topics")
        else:
            if 'topics' not in df.columns:
                df['topics'] = None
            already_processed = 0
        
        # Find sentences that need processing
        # sentences with "none" are already processed and found to have no topics
        needs_processing = df['topics'].isna()
        num_to_process = needs_processing.sum()
        
        if num_to_process == 0:
            print(f"   ✓ All sentences already have topics assigned!")
            return df
        
        print(f"   → Need to process {num_to_process} sentences ({num_to_process / len(df) * 100:.1f}%)")
        
        # Prepare list of sentences to process
        sentences_to_process = [
            (idx, row[text_column])
            for idx, row in df[needs_processing].iterrows()
        ]
        
        start_time = time.time()
        
        # Multi-pass processing
        for pass_num in range(1, self.max_passes + 1):
            if not sentences_to_process:
                break
            
            print(f"\n   Pass {pass_num}: Processing {len(sentences_to_process)} sentences")
            sentences_to_process = self._process_pass(sentences_to_process, pass_num, df)
            
            # Run callback after each pass if provided
            if on_pass_complete:
                on_pass_complete(df)
        
        # Final individual processing for any remaining failures
        if sentences_to_process:
            print(f"\n   → {len(sentences_to_process)} sentences still need processing, using individual fallback")
            individual_results = self._process_individual(sentences_to_process)
            
            for idx, result in individual_results.items():
                df.at[idx, 'topics'] = result['topics']
            
            if self.cache_path:
                df.to_csv(self.cache_path, sep='\t', index=False)
            
            if on_pass_complete:
                on_pass_complete(df)
        
        elapsed = time.time() - start_time
        rate = num_to_process / elapsed if elapsed > 0 else 0
        
        print(f"\n   ✓ Assigned topics to {num_to_process} sentences")
        print(f"   ✓ Processing rate: {rate:.1f} sentences/sec")
        
        return df
