# Cacatua Data Preparation

This directory contains the tools and data used to process, filter, and classify the sentence dataset for the Cacatua application.

We use two main pipelines:

1. **Filtering Pipeline**: Filters out sentences based on profanity, political content, and other quality criteria.
2. **Classification Pipeline**: Assigns difficulty levels (CEFR) and topical tags to the filtered sentences.

A rough overview of the data flow can be found here: [Google Drive Overview](https://drive.google.com/file/d/149Os7GPUQ4DQJLkd7CBFWIxkfCelk43m/view?usp=sharing)

## Input Files

Located in `data/inputs/`:

- `sentences.csv`: Raw sentence data (from Tatoeba).
- `A1_essential_sentences.csv` & `A2_essential_sentences.csv`: Hand-picked core sentences for beginners to ensure high-quality initial learning material.

## Data Filtering Pipeline

Orchestrated by `data_filtering/data_filtering_pipeline.py`, the pipeline cleans the raw data through several stages:

1. **Deduplication**: Extracting and deduplicating English sentences from source data (e.g., Tatoeba).
2. **Structural Filtering**: Filtering by length and removing sentences with banned words using `filter_sentences`.
3. **OpenAI Moderation**: (Optional) Preliminary filtering using the OpenAI Moderation API.
4. **Name Limits**: Capping the frequency of common names (e.g., "Tom", "Mary") to ensure variety in the dataset.
5. **LLM Analysis (Gemini)**: Detailed classification and moderation using LLMs via OpenRouter to assess usefulness and flag sensitive content.

## Language Intelligence

Located in `language_intelligence/`:

- **CEFR Classification**: Uses spaCy and custom logic to assign difficulty levels (A1-C2) based on vocabulary.
- **Word Rank Analysis**: Calculates the "max word rank" for each sentence to further refine difficulty within CEFR levels.

## Dataset Creation & Topic Classification

1. **`dataset_creation.py`**: Samples sentences from the filtered pool based on difficulty level and word rank distribution constraints to create a balanced learning progression.
2. **`dataset_topic_classification.py`**: Uses batch LLM processing to assign topical tags to sentences, enabling users to learn vocabulary in specific contexts.

## File Structure

- `data/inputs/`: Raw source data and hand-picked essential sentence lists.
- `data/intermediate_outputs/`: Temporary files generated during pipeline stages.
- `data/output/`: Final processed datasets, including `sentences.csv` and difficulty-based files.
- `data_filtering/`: Modern filtering pipeline logic (`data_filtering_pipeline.py` and utils).
- `language_intelligence/`: Logic for CEFR, word ranks, and LLM classifiers.
- `dataset_creation.py`: Script for creating the final sampled and ranked dataset.
- `dataset_topic_classification.py`: Script for adding topics to the final dataset.
- `requirements.txt`: Python dependencies for the data preparation scripts.

## Setup and Usage

### 1. Environment Setup

Create and activate a conda environment using the provided `requirements.txt`:

```bash
conda create --name cacatua-prep --file requirements.txt
conda activate cacatua-prep
```

### 2. Environment Variables

Set the following environment variables for moderation and LLM analysis:

```bash
export OPENAI_API_KEY="your_openai_key"
export OPENROUTER_API_KEY="your_openrouter_key"
```

### 3. Prepare Input Files

Ensure the required files are present in `data/inputs/` (see **Input Files** section above).

### 4. Run the Pipeline

Execute the data preparation steps in order:

1. **Data Filtering & Classification**:
   ```bash
   python data_filtering/data_filtering_pipeline.py
   ```
2. **Dataset Creation**:
   ```bash
   python dataset_creation.py
   ```
3. **Topic Classification**:
   ```bash
   python dataset_topic_classification.py
   ```
