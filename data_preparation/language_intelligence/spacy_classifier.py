
import os 
import sys



import spacy
import pandas as pd
from pathlib import Path
from typing import List, Dict, Any, Optional
from cefrpy import CEFRAnalyzer
from wordfreq import zipf_frequency, word_frequency


# Hardcoded CEFR levels for special words/contractions
HARDCODED_CEFR_LEVELS = {
    "'s": "A2",      # Possessive or "is" contraction
    "'ve": "A2",     # "have" contraction
    "n't": "A2",     # "not" contraction
    "'m": "A2",      # "am" contraction
    "'ll": "A2",     # "will" contraction
    "'re": "A2",     # "are" contraction
    "'d": "A2",      # "would/had" contraction
    "a.m.": "B1",
    "p.m.": "B1",
    "-": "B1",
}

# Default configuration for sentence difficulty classification
DEFAULT_DIFFICULTY_CONFIG = {
    'A1': {
        'max_words_with_stops': 11,
        'max_words_without_stops': 9,
        'level_limits': {
            'A1': -1,    
            'A2': 0,    
            'B1': 0,    
            'B2': 0,
            'C1': 0,
            'C2': 0
        }
    },
    'A2': {
        'max_words_with_stops': 16,
        'max_words_without_stops': 13,
        'level_limits': {
            'A1': -1,
            'A2': -1,   
            'B1': 0,    
            'B2': 0,
            'C1': 0,
            'C2': 0
        }
    },
    'B1': {
        'max_words_with_stops': 20,
        'max_words_without_stops': 15,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,    
            'B2': 0,     
            'C1': 0,    
            'C2': 0
        }
    },
    'B2': {
        'max_words_with_stops': 25,
        'max_words_without_stops': 20,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,   
            'C1': 0,   
            'C2': 0,      
        }
    },
    'C1': {
        'max_words_with_stops': 30,
        'max_words_without_stops': 25,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,
            'C1': -1,    
            'C2': 0     
        }
    },
    'C2': {
        'max_words_with_stops': -1,  
        'max_words_without_stops': -1,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,
            'C1': -1,
            'C2': -1     
        }
    }
}

APPROX_CEFR_LEVEL_CONFIG = {
    'A1': {
        'max_words_with_stops': 12,
        'max_words_without_stops': 10,
        'level_limits': {
            'A1': -1,    
            'A2': 1,    
            'B1': 0,    
            'B2': 0,
            'C1': 0,
            'C2': 0
        }
    },
    'A2': {
        'max_words_with_stops': 16,
        'max_words_without_stops': 13,
        'level_limits': {
            'A1': -1,
            'A2': -1,   
            'B1': 1,    
            'B2': 1,
            'C1': 0,
            'C2': 0
        }
    },
    'B1': {
        'max_words_with_stops': 20,
        'max_words_without_stops': 15,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,    
            'B2': 2,     
            'C1': 1,    
            'C2': 1
        }
    },
    'B2': {
        'max_words_with_stops': 25,
        'max_words_without_stops': 20,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,   
            'C1': 1,   
            'C2': 1,      
        }
    },
    'C1': {
        'max_words_with_stops': 30,
        'max_words_without_stops': 25,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,
            'C1': -1,    
            'C2': 2     
        }
    },
    'C2': {
        'max_words_with_stops': -1,  
        'max_words_without_stops': -1,
        'level_limits': {
            'A1': -1,
            'A2': -1,
            'B1': -1,
            'B2': -1,
            'C1': -1,
            'C2': -1     
        }
    }
}
class SentenceClassifier:
    def __init__(self, spacy_model: str = "en_core_web_sm", language: str = "en"):
        self.nlp = spacy.load(spacy_model)
        self.cefr_analyzer = CEFRAnalyzer()
        self.language = language
        self.doc = None
        self.text = None
        self._top_20k_words = None
        self._common_names = None
        self._names_csv_path = Path(__file__).parent / "output" / "common_names.csv"
    
    def _get_top_20k_words(self):
        if self._top_20k_words is None:
            from wordfreq import top_n_list
            self._top_20k_words = top_n_list(self.language, 20000)
        return self._top_20k_words
    
    def _get_common_names(self):
        """Load common names from CSV file (case-insensitive lookup)."""
        if self._common_names is None:
            try:
                if self._names_csv_path.exists():
                    df = pd.read_csv(self._names_csv_path)
                    # Convert all names to lowercase for case-insensitive matching
                    self._common_names = set(name.lower() for name in df['name'].values)
                else:
                    print(f"Warning: Names CSV not found at {self._names_csv_path}")
                    self._common_names = set()
            except Exception as e:
                print(f"Warning: Failed to load common names: {e}")
                self._common_names = set()
        return self._common_names
    
    def is_common_name(self, word: str) -> bool:
        """
        Check if a word is a common name.
        
        Args:
            word: The word to check
            
        Returns:
            True if the word is in the common names list, False otherwise
        """
        common_names = self._get_common_names()
        return word.lower() in common_names
    
    def get_zipf_score(self, word: str) -> float:
        return zipf_frequency(word, self.language)
    
    def get_word_rank(self, word: str, lemma: Optional[str] = None) -> Optional[int]:
        top_words = self._get_top_20k_words()
        
        # Create a dictionary for O(1) lookup if it doesn't exist
        if not hasattr(self, '_word_rank_dict'):
            self._word_rank_dict = {w: i + 1 for i, w in enumerate(top_words)}
            
        word_lower = word.lower()
        
        # 1. Regular lookup
        if word_lower in self._word_rank_dict:
            return self._word_rank_dict[word_lower]
            
        # 2. Lemma fallback
        if lemma:
            lemma_lower = lemma.lower()
            if lemma_lower in self._word_rank_dict:
                return self._word_rank_dict[lemma_lower]
                
        return None
    
    def get_lemma_rank(self, lemma: str) -> Optional[int]:
        top_words = self._get_top_20k_words()
        if not hasattr(self, '_word_rank_dict'):
            self._word_rank_dict = {w: i + 1 for i, w in enumerate(top_words)}
            
        lemma_lower = lemma.lower()
        return self._word_rank_dict.get(lemma_lower)
    
    def get_min_rank(self, word: str, lemma: str) -> Optional[int]:
        ranks = []
        
        r1 = self.get_word_rank(word, lemma)
        if r1 is not None:
            ranks.append(r1)
        
        return min(ranks) if ranks else None
    
    def get_cefr_level(self, word: str, is_entity: bool = False) -> Optional[str]:
        if is_entity:
            return None
        try:
            cefr_result = self.cefr_analyzer.get_average_word_level_CEFR(word.lower())
            return str(cefr_result.name) if cefr_result else None
        except:
            pass
        return None
    
    def get_cefr_from_rank(self, rank: Optional[int]) -> Optional[str]:
        if rank is None:
            return None
        if rank <= 500:
            return 'A1'
        elif rank <= 1000:
            return 'A2'
        elif rank <= 2000:
            return 'B1'
        elif rank <= 3000:
            return 'B2'
        elif rank <= 5000:
            return 'B2'
        elif rank <= 10000:
            return 'C1'
        else:
            return 'C2'
    
    def get_combined_cefr(self, word: str, lemma: str, is_entity: bool, word_rank: Optional[int]) -> Optional[str]:
        cefr_order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
        
        # Check hardcoded levels first
        if word.lower() in HARDCODED_CEFR_LEVELS:
            return HARDCODED_CEFR_LEVELS[word.lower()]
        
        db_cefr = self.get_cefr_level(word, is_entity)
        
        if db_cefr:
            rank_cefr = self.get_cefr_from_rank(word_rank)
            if rank_cefr:
                db_idx = cefr_order.index(db_cefr)
                rank_idx = cefr_order.index(rank_cefr)
                return cefr_order[max(db_idx, rank_idx)]
            else:
                return db_cefr
        else:
            min_rank = self.get_min_rank(word, lemma)
            rank_cefr = self.get_cefr_from_rank(min_rank)
            return rank_cefr
    
    def get_digit_difficulty(self, shape: str) -> Optional[str]:
        """
        Classify difficulty level for numbers based on their digit count.
        
        Args:
            shape: Token shape (e.g., 'd' for 5, 'dd' for 25, 'ddd' for 125)
            
        Returns:
            CEFR level: 'A1' for single digit, 'A2' for two digits, 'B1' for more
        """
        rank = self.get_digit_rank(shape)
        return self.get_cefr_from_rank(rank)
    
    def get_digit_rank(self, shape: str) -> Optional[int]:
        """
        Get equivalent word rank for numbers based on their digit count.
        """
        digit_count = shape.count('d')
        if digit_count == 1:
            return 500  # A1 threshold
        elif digit_count == 2:
            return 1000 # A2 threshold
        elif digit_count > 2:
            return 2000 # B1 threshold
        return None

    def get_max_word_rank(self) -> int:
        """
        Calculate the maximum word rank in the sentence.
        Ignores names, named entities, proper nouns, and hardcoded contractions.
        For numbers, uses digit-based rank mapping.
        """
        ranks = self._get_sentence_ranks()
        return max(ranks) if ranks else 0

    def get_average_word_rank(self) -> float:
        """
        Calculate the average word rank in the sentence.
        Ignores names, named entities, proper nouns, and hardcoded contractions.
        For numbers, uses digit-based rank mapping.
        """
        ranks = self._get_sentence_ranks()
        if not ranks:
            return 0.0
        return sum(ranks) / len(ranks)

    def _get_sentence_ranks(self) -> List[int]:
        """Helper to get a list of ranks for all valid tokens in the sentence."""
        if not self.doc:
            return []
            
        ranks = []
        for token in self.doc:
            # Handle names and named entities
            is_name = self.is_common_name(token.text)
            is_entity = token.ent_type_ != ''
            
            if is_name:
                ranks.append(300)
                continue
            
            if is_entity or token.pos_ == 'PROPN':
                # For named entities that are not common names, try to find their actual rank
                actual_rank = self.get_word_rank(token.text, token.lemma_)
                if actual_rank is not None:
                    # Apply the minimum rank of 300 to ensure they aren't treated as "too common"
                    ranks.append(max(actual_rank, 20001))
                else:
                    # Fallback for entities not in the top 20k
                    ranks.append(20001)
                continue
                
            # Ignore hardcoded contractions and symbols
            if token.text.lower() in HARDCODED_CEFR_LEVELS:
                continue

            # Ignore punctuation, symbols, spaces
            if token.pos_ in ['PUNCT', 'SYM', 'SPACE']:
                continue
                
            if token.pos_ == 'NUM':
                digit_rank = self.get_digit_rank(token.shape_)
                if digit_rank:
                    ranks.append(digit_rank)
                else:
                    # For written-out numbers (e.g., "Three"), use the threshold rank
                    # associated with their difficulty level to be consistent with digits
                    word_rank = self.get_word_rank(token.text, token.lemma_)
                    cefr = self.get_cefr_from_rank(word_rank)
                    thresholds = {'A1': 500, 'A2': 1000, 'B1': 2000, 'B2': 5000, 'C1': 10000}
                    ranks.append(thresholds.get(cefr, 20001))
                continue
                
            rank = self.get_word_rank(token.text, token.lemma_)
            if rank is not None:
                ranks.append(rank)
            else:
                # Word not in top 20k
                ranks.append(20001)
                
        return ranks

    def sentence(self, text: str):
        # Replace curly apostrophes with normal apostrophes before processing
        text = text.replace('’', "'").replace('´', "'")
        self.text = text
        self.doc = self.nlp(text)
        return self
    
    def lemmas(self, stop_words: bool = False) -> List[str]:
        if not self.doc:
            return []
        tokens = [token for token in self.doc 
                 if token.pos_ not in ['PUNCT', 'NUM', 'SYM', 'SPACE']]
        if stop_words:
            tokens = [token for token in tokens if not token.is_stop]
        return [token.lemma_ for token in tokens]
    
    def words(self, stop_words: bool = False, pos_tags: bool = False) -> List[Dict[str, Any]]:
        if not self.doc:
            return []
        tokens = [token for token in self.doc 
                 if token.pos_ not in ['PUNCT', 'NUM', 'SYM', 'SPACE']]
        if stop_words:
            tokens = [token for token in tokens if not token.is_stop]
        
        result = []
        for token in tokens:
            word_info = {'word': token.text, 'is_entity': token.ent_type_ != ''}
            if pos_tags:
                word_info.update({'pos': token.pos_, 'tag': token.tag_})
            result.append(word_info)
        return result
    
    def numbers(self) -> List[str]:
        if not self.doc:
            return []
        return [token.text for token in self.doc if token.pos_ == 'NUM']
    
    def get_cefr_level_words(self) -> List[Dict[str, Any]]:
        if not self.doc:
            return []
        words_data = self.words(stop_words=False, pos_tags=True)
        result = []
        
        for word_data in words_data:
            token = next((t for t in self.doc if t.text == word_data['word']), None)
            if not token:
                continue
            
            cefr_level = self.get_cefr_level(word_data['word'], word_data['is_entity'])
            result.append({
                'word': word_data['word'],
                'pos': word_data['pos'],
                'tag': word_data['tag'],
                'is_entity': word_data['is_entity'],
                'cefr_level': cefr_level
            })
        return result
    
    def calculate_cefr(self) -> Optional[str]:
        return None
    
    def conjunctions(self) -> int:
        if not self.doc:
            return 0
        return sum(1 for token in self.doc if token.tag_ == 'CC')
    
    def number_of_words(self, stop_words: bool = False) -> int:
        if not self.doc:
            return 0
        tokens = [token for token in self.doc 
                 if token.pos_ not in ['PUNCT', 'NUM', 'SYM', 'SPACE']]
        if stop_words:
            tokens = [token for token in tokens if not token.is_stop]
        return len(tokens)
    
    def classification(self) -> List[Dict[str, Any]]:
        if not self.doc:
            return []
        
        result = []
        for token in self.doc:
            zipf_score = self.get_zipf_score(token.text)
            word_rank = self.get_word_rank(token.text, token.lemma_)
            lemma_rank = self.get_lemma_rank(token.lemma_)
            is_entity = token.ent_type_ != ''
            is_name = self.is_common_name(token.text)
            cefr_level = self.get_cefr_level(token.text, is_entity)
            combined_cefr = self.get_combined_cefr(token.text, token.lemma_, is_entity, word_rank)
            
            # For numbers (NUM POS tag), use digit difficulty instead of combined_cefr
            digit_difficulty = None
            if token.pos_ == 'NUM':
                digit_difficulty = self.get_digit_difficulty(token.shape_)
                # Override combined_cefr with digit difficulty for numbers
                if digit_difficulty:
                    combined_cefr = digit_difficulty
            
            result.append({
                'text': token.text,
                'lemma': token.lemma_,
                'pos': token.pos_,
                'tag': token.tag_,
                'dep': token.dep_,
                'shape': token.shape_,
                'is_alpha': token.is_alpha,
                'is_stop': token.is_stop,
                'is_name': is_name,
                'zipf_score': round(zipf_score, 2),
                'word_rank': word_rank,
                'lemma_rank': lemma_rank,
                'cefr_level': cefr_level,
                'combined_cefr': combined_cefr,
                'digit_difficulty': digit_difficulty
            })
        
        return result
    
    def sentence_difficulty(self, config: Optional[Dict] = None) -> str:
        """
        Determine the CEFR difficulty level of the current sentence.
        
        Returns the lowest CEFR level that satisfies all constraints.
        
        Args:
            config: Optional custom configuration. If None, uses DEFAULT_DIFFICULTY_CONFIG
            
        Returns:
            CEFR level string ('A1', 'A2', 'B1', 'B2', 'C1', or 'C2')
        """
        if not self.doc:
            return 'A1'  # Default for empty sentence
        
        # Use provided config or default
        if config is None:
            config = DEFAULT_DIFFICULTY_CONFIG
        
        # Step 1: Get classification data
        classification = self.classification()
        
        # Step 2: Filter tokens for word counting
        # Exclude only: Punctuation, Symbols, and Spaces
        # Include: Numbers, Names, Named entities (they count toward word count)
        filtered_tokens = []
        for item in classification:
            # Skip only punctuation, symbols, and spaces
            if item['pos'] in ['PUNCT', 'SYM', 'SPACE']:
                continue
            filtered_tokens.append(item)
        
        # Count words with and without stops
        words_with_stops = len(filtered_tokens)
        words_without_stops = len([t for t in filtered_tokens if not t['is_stop']])
        
        # Step 3: Count CEFR levels
        # Names, named entities, and punctuation don't count toward CEFR limits
        cefr_counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}
        for item in filtered_tokens:
            # Skip names and named entities for CEFR counting
            if item['is_name'] or item['pos'] == 'PROPN':
                continue
            
            level = item.get('combined_cefr')
            # Treat unclassifiable words (None) as C2 level
            if level is None:
                level = 'B2'
            if level in cefr_counts:
                cefr_counts[level] += 1
        
        # Step 4: Check constraints for each level in order
        cefr_levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
        
        for level in cefr_levels:
            level_config = config[level]
            
            # Check word count constraints
            max_with_stops = level_config['max_words_with_stops']
            max_without_stops = level_config['max_words_without_stops']
            
            # Check if word counts satisfy constraints (-1 means unlimited)
            if max_with_stops != -1 and words_with_stops > max_with_stops:
                continue  # This level's word count constraint failed
            
            if max_without_stops != -1 and words_without_stops > max_without_stops:
                continue  # This level's word count constraint failed
            
            # Check CEFR level distribution constraints
            level_limits = level_config['level_limits']
            constraints_satisfied = True
            
            for cefr_level, limit in level_limits.items():
                if limit != -1 and cefr_counts[cefr_level] > limit:
                    constraints_satisfied = False
                    break
            
            if constraints_satisfied:
                # All constraints for this level are satisfied
                return level
        
        # Step 5: Fallback - if no level satisfies constraints, return C2
        return 'C2'
    
    def visualise(self, output_file: Optional[str] = None):
        """
        Visualize the sentence classification.
        
        Args:
            output_file: Optional path to save the output to a file
        """
        if not self.doc:
            message = "No sentence set"
            print(message)
            if output_file:
                with open(output_file, 'a', encoding='utf-8') as f:
                    f.write(message + "\n")
            return
        
        lines = []
        lines.append(f"\nSentence: \"{self.text}\"")
        
        # Add sentence difficulty
        difficulty = self.sentence_difficulty()
        lines.append(f"Sentence Difficulty: {difficulty}")
        
        lines.append(f"\n{'Text':<15} {'Lemma':<15} {'POS':<8} {'Tag':<8} {'Dep':<10} {'Shape':<10} {'Alpha':<7} {'Stop':<7} {'Name':<7} {'Zipf':<7} {'Rank':<7} {'LRank':<7} {'CEFR':<6} {'Combined':<8} {'DigitDiff':<9}")
        lines.append(f"{'-'*15} {'-'*15} {'-'*8} {'-'*8} {'-'*10} {'-'*10} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*6} {'-'*8} {'-'*9}")
        
        classification = self.classification()
        for item in classification:
            rank_str = str(item['word_rank']) if item['word_rank'] else 'N/A'
            lemma_rank_str = str(item['lemma_rank']) if item['lemma_rank'] else 'N/A'
            cefr_str = item['cefr_level'] if item['cefr_level'] else 'N/A'
            combined_str = item['combined_cefr'] if item['combined_cefr'] else 'N/A'
            digit_diff_str = item['digit_difficulty'] if item.get('digit_difficulty') else 'N/A'
            line = (f"{item['text']:<15} {item['lemma']:<15} {item['pos']:<8} {item['tag']:<8} "
                    f"{item['dep']:<10} {item['shape']:<10} {str(item['is_alpha']):<7} {str(item['is_stop']):<7} "
                    f"{str(item['is_name']):<7} {item['zipf_score']:<7.2f} {rank_str:<7} {lemma_rank_str:<7} {cefr_str:<6} {combined_str:<8} {digit_diff_str:<9}")
            lines.append(line)
        
        # Print to console
        for line in lines:
            print(line)
        
        # Save to file if specified
        if output_file:
            with open(output_file, 'a', encoding='utf-8') as f:
                for line in lines:
                    f.write(line + "\n")
                f.write("\n")  # Add extra line between entries


if __name__ == "__main__":
    print("="*80)
    print("TESTING SENTENCE CLASSIFIER")
    print("="*80)
    
    csv_path = Path(__file__).parent.parent / "data" / "output" / "classified_sentences_not_flagged.csv"
    df = pd.read_csv(csv_path, sep=";")
    df_sample = df.sample(n=min(10000, len(df)), random_state=42)
    
    print(f"\nLoaded {len(df_sample)} random sentences from CSV")
    
    # Track difficulty level counts
    difficulty_counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}
    
    # Track unclassifiable words
    unclassifiable_sentences = []
    
    # Setup output file
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / "spacy_classifier_output.txt"
    
    # Setup difficulty level output directory
    difficulty_dir = output_dir / "sentence_difficulty"
    difficulty_dir.mkdir(exist_ok=True)
    
    # Create/clear difficulty level files
    difficulty_files = {}
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        file_path = difficulty_dir / f"{level}_sentences.txt"
        difficulty_files[level] = file_path
        # Clear the file if it exists
        if file_path.exists():
            file_path.unlink()
        # Write header
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(f"CEFR Level {level} Sentences\n")
            f.write("="*80 + "\n\n")
    
    # Clear the output file if it exists
    if output_file.exists():
        output_file.unlink()
    
    print(f"Saving output to: {output_file}")
    print(f"Saving difficulty classifications to: {difficulty_dir}")
    
    classifier = SentenceClassifier()
    
    # Write header to file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("SENTENCE CLASSIFIER OUTPUT\n")
        f.write("="*80 + "\n\n")
    
    for idx, row in df_sample.iterrows():
        text = row['text']
        print(f"\n{'='*80}")
        print(f"Sentence {idx + 1}: \"{text}\"")
        print(f"{'='*80}")
        
        # Write to file
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write("="*80 + "\n")
            f.write(f"Sentence {idx + 1}: \"{text}\"\n")
            f.write("="*80 + "\n")
        
        classifier.sentence(text)
        
        # Sentence difficulty
        difficulty = classifier.sentence_difficulty()
        print(f"\nSentence Difficulty: {difficulty}")
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nSentence Difficulty: {difficulty}\n")
        
        # Save sentence to appropriate difficulty level file
        difficulty_file = difficulty_files[difficulty]
        with open(difficulty_file, 'a', encoding='utf-8') as f:
            f.write(f"{text}\n")
        
        # Track count
        difficulty_counts[difficulty] += 1
        
        # Check for unclassifiable words
        classification_data = classifier.classification()
        unclassifiable_words = []
        for item in classification_data:
            # Skip punctuation, symbols, spaces, names, and proper nouns
            if item['pos'] in ['PUNCT', 'SYM', 'SPACE']:
                continue
            if item['is_name'] or item['pos'] == 'PROPN':
                continue
            # Check if word has no CEFR classification
            if item.get('combined_cefr') is None:
                unclassifiable_words.append(item['text'])
        
        # If there are unclassifiable words, save the sentence
        if unclassifiable_words:
            unclassifiable_sentences.append({
                'sentence': text,
                'words': unclassifiable_words
            })
        
        # Lemmas
        lemmas_with = classifier.lemmas(stop_words=False)
        lemmas_without = classifier.lemmas(stop_words=True)
        print(f"\nLemmas (with stop words): {lemmas_with}")
        print(f"Lemmas (without stop words): {lemmas_without}")
        
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nLemmas (with stop words): {lemmas_with}\n")
            f.write(f"Lemmas (without stop words): {lemmas_without}\n")
        
        # Words
        words = classifier.words(stop_words=False, pos_tags=True)
        print(f"\nWords: {words}")
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nWords: {words}\n")
        
        # Numbers
        numbers = classifier.numbers()
        print(f"\nNumbers: {numbers}")
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nNumbers: {numbers}\n")
        
        # Statistics
        conj = classifier.conjunctions()
        num_words_with = classifier.number_of_words(stop_words=False)
        num_words_without = classifier.number_of_words(stop_words=True)
        print(f"\nConjunctions: {conj}")
        print(f"Number of words (with stop words): {num_words_with}")
        print(f"Number of words (without stop words): {num_words_without}")
        
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nConjunctions: {conj}\n")
            f.write(f"Number of words (with stop words): {num_words_with}\n")
            f.write(f"Number of words (without stop words): {num_words_without}\n")
        
        # CEFR Level Words
        print(f"\nCEFR Level Words:")
        cefr_words = classifier.get_cefr_level_words()
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\nCEFR Level Words:\n")
            for word_info in cefr_words:
                line = (f"  {word_info['word']:<15} POS: {word_info['pos']:<10} "
                        f"Entity: {str(word_info['is_entity']):<6} "
                        f"CEFR: {word_info['cefr_level']}")
                print(line)
                f.write(line + "\n")
        
        # Visualize (will print and save to file)
        classifier.visualise(output_file=str(output_file))
        

    
    # Demonstrate sentence difficulty with example sentences
    print("\n" + "="*80)
    print("SENTENCE DIFFICULTY DEMONSTRATION")
    print("="*80)
    
    with open(output_file, 'a', encoding='utf-8') as f:
        f.write("\n" + "="*80 + "\n")
        f.write("SENTENCE DIFFICULTY DEMONSTRATION\n")
        f.write("="*80 + "\n\n")
    
    example_sentences = [
        ("I am a cat.", "A1 - Simple sentence with basic words"),
        ("The dog runs fast.", "A1/A2 - Short sentence with common words"),
        ("She went to the store yesterday.", "A2 - Basic past tense"),
        ("The children are playing in the garden.", "A2/B1 - Present continuous"),
        ("I have been studying English for three years.", "B1 - Present perfect continuous"),
        ("The economic situation requires careful analysis.", "B2 - More complex vocabulary"),
        ("The implementation of sustainable development strategies necessitates comprehensive evaluation.", "C1 - Advanced academic language"),
        ("I have 5 apples and 25 oranges.", "A2 - Numbers included"),
    ]
    
    for sentence, description in example_sentences:
        print(f"\n{'-'*80}")
        print(f"Example: {description}")
        print(f"Sentence: \"{sentence}\"")
        
        classifier.sentence(sentence)
        difficulty = classifier.sentence_difficulty()
        
        print(f"Detected Difficulty: {difficulty}")
        
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write(f"\n{'-'*80}\n")
            f.write(f"Example: {description}\n")
            f.write(f"Sentence: \"{sentence}\"\n")
            f.write(f"Detected Difficulty: {difficulty}\n")
    
    # Save unclassifiable words report
    unclassifiable_file = output_dir / "unclassifiable_words_report.txt"
    
    # Collect all unique unclassifiable words with counts
    word_counts = {}
    for entry in unclassifiable_sentences:
        for word in entry['words']:
            word_counts[word] = word_counts.get(word, 0) + 1
    
    with open(unclassifiable_file, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("SENTENCES WITH UNCLASSIFIABLE WORDS\n")
        f.write("="*80 + "\n\n")
        f.write(f"Total sentences with unclassifiable words: {len(unclassifiable_sentences)}\n")
        f.write(f"Percentage of total: {(len(unclassifiable_sentences) / len(df_sample) * 100):.1f}%\n")
        f.write(f"Total unique unclassifiable words: {len(word_counts)}\n\n")
        
        # Write summary of unique words
        f.write("="*80 + "\n")
        f.write("UNIQUE UNCLASSIFIABLE WORDS (sorted by frequency)\n")
        f.write("="*80 + "\n\n")
        
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
        for word, count in sorted_words:
            f.write(f"{word:<30} (appears {count} times)\n")
        
        # Write detailed sentence list
        f.write("\n" + "="*80 + "\n")
        f.write("DETAILED SENTENCE LIST\n")
        f.write("="*80 + "\n")
        
        for i, entry in enumerate(unclassifiable_sentences, 1):
            f.write(f"\n{'-'*80}\n")
            f.write(f"Sentence {i}:\n")
            f.write(f"{entry['sentence']}\n\n")
            f.write(f"Unclassifiable words ({len(entry['words'])}):\n")
            for word in entry['words']:
                f.write(f"  - {word}\n")
        
        f.write(f"\n{'='*80}\n")
        f.write("END OF REPORT\n")
        f.write("="*80 + "\n")
    
    print(f"\nUnclassifiable words report saved to: {unclassifiable_file}")
    print(f"  Total sentences with unclassifiable words: {len(unclassifiable_sentences)}")
    
    # Write summary to each difficulty file
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        with open(difficulty_files[level], 'a', encoding='utf-8') as f:
            f.write(f"\n{'-'*80}\n")
            f.write(f"Total {level} sentences: {difficulty_counts[level]}\n")
    
    print("\n" + "="*80)
    print("DIFFICULTY LEVEL SUMMARY")
    print("="*80)
    
    print(f"\nSentences classified by difficulty level:")
    for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        count = difficulty_counts[level]
        percentage = (count / len(df_sample)) * 100 if len(df_sample) > 0 else 0
        print(f"  {level}: {count:3d} sentences ({percentage:5.1f}%)")
        print(f"       File: {difficulty_files[level]}")
    
    with open(output_file, 'a', encoding='utf-8') as f:
        f.write("\n" + "="*80 + "\n")
        f.write("DIFFICULTY LEVEL SUMMARY\n")
        f.write("="*80 + "\n\n")
        f.write("Sentences classified by difficulty level:\n")
        for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
            count = difficulty_counts[level]
            percentage = (count / len(df_sample)) * 100 if len(df_sample) > 0 else 0
            f.write(f"  {level}: {count:3d} sentences ({percentage:5.1f}%)\n")
    
    print("\n" + "="*80)
    print("TESTING COMPLETE")
    print("="*80)
    print(f"\nOutput saved to: {output_file}")
    print(f"Difficulty classifications saved to: {difficulty_dir}")
    print(f"Unclassifiable words report: {unclassifiable_file}")
    
    with open(output_file, 'a', encoding='utf-8') as f:
        f.write("\n" + "="*80 + "\n")
        f.write("TESTING COMPLETE\n")
        f.write("="*80 + "\n")
        f.write(f"\nUnclassifiable words report: {unclassifiable_file}\n")
