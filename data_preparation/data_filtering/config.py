#!/usr/bin/env python3
"""
Configuration constants for data processing pipeline.
Centralized configuration for classification, moderation, and filtering.
"""

# API Configuration
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Classification Models (with fallback order)
MODELS = [
    "google/gemini-2.5-flash-lite", 
]

# Batch Processing
BATCH_SIZE = 40  # Unified batch size for classification
DELAY_BETWEEN_REQUESTS = 2  # seconds between API requests

# Pricing per million tokens (in USD)
INPUT_PRICE_PER_MILLION = 0.10  # $0.1 per million input tokens
OUTPUT_PRICE_PER_MILLION = 0.40  # $0.4 per million output tokens

# Moderation Settings
MODERATION_BATCH_SIZE = 40  # Number of sentences to check per API call
MODERATION_DELAY = 0.8  # Delay between moderation API calls (seconds)

# Filtering Settings
MAX_WORDS = 30
BANNED_WORDS = [
    "tatoeba",
    "trump",
    "CO", 
    "epstein",
    "suicide",
    "sex",
    "palestine", 
    "Jews", 
    "Muslims", 
    "Christians", 
    "Algeria", 
    "Algiers", 
    "Berber", 
    "Hindus", 
    "Buddhists", 
    "homosexuals", 
    "Viagra", 
    "Iraq", 
    "Iran", 
    "cosine", 
    "killing", 
    "assholes", 
    "Judaism", 
    "Islam", 
    "Christianity", 
    "killed", 
    "Hinduism", 
    "Buddhism", 
    "Kangxi", 
    "Zionist",
    "Zionism", 
    "Jerusalem", 
    "West Bank", 
    "Gaza", 
    "Atheism", 
    "Jewish", 
    "Muslim", 
    "Christian", 
    "Hindu", 
    "Buddhist", 
    "israel", 
    "abortion",
    "fuck",
    "shit",
    "pussy",
    "dick",
    "cock",
    "cunt",
    "faggot",
    "nigger",
    "asexual", 
    "autism",
    "autistic",
    "bisexual", 
    "kill", 
    "queer", 
    "transgender", 
    "racism", 
    "obesity", 
    'suck',
    'stupid',
    'pimp',
    'dumb',
    'homosexual',
    'slut',
    'damn',
    'ass',
    'rape',
    'poop',
    'cock',
    'lol',
    'crap',
    'sex',
    'nazi',
    'neo-nazi',
    'fuck',
    'bitch',
    'pussy',
    'penis',
    'vagina',
    'whore',
    'shit',
    'nigger',
    'nigga',
    'cocksucker',
    'assrape',
    'motherfucker',
    'wanker',
    'cunt',
    'faggot',
    'fags',
    'asshole',
    'piss',
    'cum', 
    "Russia", 
    "Quran", 
    "Algerian", 
    "ex-Jew", 
]

# Content Flags
PROBLEMATIC_FLAGS = [
    "sexist", 
    "racist", 
    "homophobic", 
    "violent", 
    "offensive", 
    "inappropriate", 
    "triggering", 
    "weird", 
    "political", 
    "audio-incompatible", 
    "hard to pronounce"
]

# Thresholds
LOW_USEFULNESS_THRESHOLD = 3

# Parallel Processing
PARALLEL_BATCH_SIZE = 1000  # Number of sentences to process per batch in parallel
PROGRESS_UPDATE_INTERVAL = 10000  # Update progress every N sentences


