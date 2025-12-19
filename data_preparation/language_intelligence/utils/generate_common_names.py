"""
Generate a list of the 1000 most common names using the names-dataset library.

This script uses the names-dataset library to fetch the most common first names
(male and female) and last names from various countries, with a focus on English-speaking
countries.
"""

import pandas as pd
from pathlib import Path
from typing import Set
from names_dataset import NameDataset

# Blacklist of words that should not be considered names
# These are common words that might appear in name databases but aren't actual names
# Note: Matching is case-insensitive (e.g., "He", "Can" will be filtered)
NAME_BLACKLIST = {
    'he', 'she', 'it', 'we', 'they',  # Pronouns
    'i', 'me', 'my', 'you', 'your',   # More pronouns
    'a', 'an', 'the',                  # Articles
    'am', 'is', 'are', 'was', 'were',  # Common verbs
    'do', 'does', 'did', 'be', 'been', # More verbs
    'will', 'shall', 'can', 'may',     # Modal verbs (includes "Can")
    'no', 'yes', 'ok', 'okay',         # Common words
}

# Manually added names that should be included regardless
MANUAL_NAMES = [
    {'name': 'Yanni', 'type': 'first', 'gender': 'male', 'country': 'Manual'},
    {'name': 'Felix', 'type': 'last', 'gender': None, 'country': 'Manual'},
    {'name': 'Sami', 'type': 'first', 'gender': 'male', 'country': 'Manual'},
    {'name': 'Janos', 'type': 'first', 'gender': 'male', 'country': 'Manual'},
    {'name': 'Gunter', 'type': 'first', 'gender': 'male', 'country': 'Manual'},
]

def generate_common_names(
    n_first_names_per_gender: int = 300,
    n_last_names: int = 0,
    countries: list = None
) -> pd.DataFrame:
    """
    Generate a list of most common names.
    
    Args:
        n_first_names_per_gender: Number of first names to include per gender per country
                                   (e.g., 50 male + 50 female = 100 total per country)
        n_last_names: Number of last names to include per country
        countries: List of country codes to fetch names from (defaults to selected countries)
        
    Returns:
        DataFrame with columns: name, type (first/last), gender (for first names)
    """
    # Default countries if not specified
    if countries is None:
        countries = ['US', 'GB', 'AU', 'DE', 'FR', 'PL', 'IT', 'JP', 'CN', 'DK', 'SE', 'NL']
    
    print("Initializing NameDataset...")
    nd = NameDataset()
    
    all_names = []
    seen_names = set()
    blacklisted_count = 0
    
    print(f"\nUsing blacklist with {len(NAME_BLACKLIST)} words: {sorted(NAME_BLACKLIST)}")
    
    # Get first names (male and female) for each country
    print("\nFetching first names...")
    for country in countries:
        print(f"  Processing country: {country}")
        country_first_names = 0
        
        # Male first names
        try:
            male_names = nd.get_top_names(
                n=n_first_names_per_gender,
                gender='Male',
                use_first_names=True,
                country_alpha2=country
            )
            
            if male_names and country in male_names:
                for name in male_names[country].get('M', []):
                    name_lower = name.lower()
                    # Skip if in blacklist
                    if name_lower in NAME_BLACKLIST:
                        blacklisted_count += 1
                        continue
                    # Skip if already seen
                    if name_lower in seen_names:
                        continue
                    all_names.append({
                        'name': name,
                        'type': 'first',
                        'gender': 'male',
                        'country': country
                    })
                    seen_names.add(name_lower)
                    country_first_names += 1
        except Exception as e:
            print(f"    Error fetching male names for {country}: {e}")
        
        # Female first names
        try:
            female_names = nd.get_top_names(
                n=n_first_names_per_gender,
                gender='Female',
                use_first_names=True,
                country_alpha2=country
            )
            
            if female_names and country in female_names:
                for name in female_names[country].get('F', []):
                    name_lower = name.lower()
                    # Skip if in blacklist
                    if name_lower in NAME_BLACKLIST:
                        blacklisted_count += 1
                        continue
                    # Skip if already seen
                    if name_lower in seen_names:
                        continue
                    all_names.append({
                        'name': name,
                        'type': 'first',
                        'gender': 'female',
                        'country': country
                    })
                    seen_names.add(name_lower)
                    country_first_names += 1
        except Exception as e:
            print(f"    Error fetching female names for {country}: {e}")
        
        print(f"    Collected {country_first_names} unique first names from {country}")
    
    # Get last names for each country (if requested)
    if n_last_names > 0:
        print("\nFetching last names...")
        for country in countries:
            print(f"  Processing country: {country}")
            country_last_names = 0
            try:
                last_names = nd.get_top_names(
                    n=n_last_names,
                    use_first_names=False,
                    country_alpha2=country
                )
                
                if last_names and country in last_names:
                    for name in last_names[country]:
                        name_lower = name.lower()
                        # Skip if in blacklist
                        if name_lower in NAME_BLACKLIST:
                            blacklisted_count += 1
                            continue
                        # Skip if already seen
                        if name_lower in seen_names:
                            continue
                        all_names.append({
                            'name': name,
                            'type': 'last',
                            'gender': None,
                            'country': country
                        })
                        seen_names.add(name_lower)
                        country_last_names += 1
                print(f"    Collected {country_last_names} unique last names from {country}")
            except Exception as e:
                print(f"    Error fetching last names for {country}: {e}")
    
    # Add manually specified names
    print(f"\nAdding {len(MANUAL_NAMES)} manually specified names...")
    for manual_name in MANUAL_NAMES:
        name_lower = manual_name['name'].lower()
        if name_lower not in seen_names and name_lower not in NAME_BLACKLIST:
            all_names.append(manual_name)
            seen_names.add(name_lower)
            print(f"  Added: {manual_name['name']}")
    
    # Convert to DataFrame
    df = pd.DataFrame(all_names)
    
    print(f"\nTotal unique names collected: {len(df)}")
    print(f"  First names: {len(df[df['type'] == 'first'])}")
    if n_last_names > 0:
        print(f"  Last names: {len(df[df['type'] == 'last'])}")
    print(f"  Names filtered by blacklist: {blacklisted_count}")
    
    return df


def save_names_to_csv(df: pd.DataFrame, output_path: Path):
    """Save the names DataFrame to a CSV file."""
    df.to_csv(output_path, index=False)
    print(f"\nNames saved to: {output_path}")


def create_simple_name_list(df: pd.DataFrame, output_path: Path):
    """Create a simple text file with just the names (one per line)."""
    names = df['name'].unique()
    with open(output_path, 'w', encoding='utf-8') as f:
        for name in sorted(names):
            f.write(f"{name}\n")
    print(f"Simple name list saved to: {output_path}")


if __name__ == "__main__":
    print("="*80)
    print("GENERATING COMMON NAMES LIST")
    print("="*80)
    
    # Set output directory
    output_dir = Path(__file__).parent.parent / "output"
    output_dir.mkdir(exist_ok=True)
    
    # Generate names: 100 first names per country (50 male + 50 female)
    # Country codes: US (American), GB (British), AU (Australian), DE (German), 
    # FR (French), PL (Polish), IT (Italian), JP (Japanese), CN (Chinese), 
    # DK (Danish), SE (Swedish), NL (Dutch)
    df = generate_common_names(
        n_first_names_per_gender=200, 
        n_last_names=0,               # No last names
        countries=['US', 'GB', 'AU', 'DE', 'FR', 'PL', 'IT', 'JP', 'CN', 'DK', 'SE', 'NL']
    )
    
    # Save to CSV
    csv_output = output_dir / "common_names.csv"
    save_names_to_csv(df, csv_output)
    
    # Also save a simple list
    txt_output = output_dir / "common_names.txt"
    create_simple_name_list(df, txt_output)
    
    # Display some statistics
    print("\n" + "="*80)
    print("STATISTICS")
    print("="*80)
    print(f"\nFirst 20 names:")
    print(df.head(20).to_string(index=False))
    
    print(f"\nNames by type:")
    print(df['type'].value_counts())
    
    if 'gender' in df.columns:
        print(f"\nFirst names by gender:")
        print(df[df['type'] == 'first']['gender'].value_counts())
    
    print(f"\nNames by country:")
    print(df['country'].value_counts())
    
    print("\n" + "="*80)
    print("GENERATION COMPLETE")
    print("="*80)

