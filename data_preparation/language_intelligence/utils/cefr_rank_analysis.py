import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from spacy_classifier import SentenceClassifier
from collections import defaultdict

print("="*80)
print("CEFR LEVEL vs WORD RANK ANALYSIS")
print("="*80)

csv_path = Path(__file__).parent.parent / "data" / "output" / "classified_sentences_not_flagged.csv"
df = pd.read_csv(csv_path, sep=";")
df_sample = df.sample(n=min(1000, len(df)), random_state=42)

print(f"\nLoaded {len(df_sample)} random sentences from CSV")
print("Processing sentences with spaCy...")

classifier = SentenceClassifier()

data_points = []
cefr_rank_map = defaultdict(list)
unknown_cefr = set()
unknown_rank = set()
unknown_both = set()

for idx, row in df_sample.iterrows():
    text = row['text']
    classifier.sentence(text)
    classification = classifier.classification()
    
    for token_data in classification:
        cefr_level = token_data['cefr_level']
        word_rank = token_data['word_rank']
        word = token_data['text'].lower()
        
        if token_data['is_alpha']:
            if not cefr_level and not word_rank:
                unknown_both.add(word)
            elif not cefr_level:
                unknown_cefr.add(word)
            elif not word_rank:
                unknown_rank.add(word)
        
        if cefr_level and word_rank:
            data_points.append({
                'cefr_level': cefr_level,
                'word_rank': word_rank,
                'word': token_data['text'],
                'zipf_score': token_data['zipf_score']
            })
            cefr_rank_map[cefr_level].append(word_rank)
    
    if (idx + 1) % 100 == 0:
        print(f"Processed {idx + 1} sentences...")

print(f"\nTotal data points collected: {len(data_points)}")

df_plot = pd.DataFrame(data_points)

print("\nCEFR Level Statistics:")
for cefr_level in sorted(cefr_rank_map.keys()):
    ranks = cefr_rank_map[cefr_level]
    print(f"  {cefr_level}: {len(ranks)} words, "
          f"Avg Rank: {sum(ranks)/len(ranks):.1f}, "
          f"Median Rank: {sorted(ranks)[len(ranks)//2]}")

output_dir = Path(__file__).parent.parent / "output"
output_dir.mkdir(exist_ok=True)

sns.set_style("whitegrid")
fig, axes = plt.subplots(2, 2, figsize=(16, 12))

cefr_order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
df_plot['cefr_level'] = pd.Categorical(df_plot['cefr_level'], categories=cefr_order, ordered=True)

ax1 = axes[0, 0]
sns.boxplot(data=df_plot, x='cefr_level', y='word_rank', ax=ax1, palette='viridis')
ax1.set_title('CEFR Level vs Word Rank (Box Plot)', fontsize=14, fontweight='bold')
ax1.set_xlabel('CEFR Level', fontsize=12)
ax1.set_ylabel('Word Rank (1-20,000)', fontsize=12)
ax1.invert_yaxis()

ax2 = axes[0, 1]
sns.violinplot(data=df_plot, x='cefr_level', y='word_rank', ax=ax2, palette='viridis')
ax2.set_title('CEFR Level vs Word Rank (Violin Plot)', fontsize=14, fontweight='bold')
ax2.set_xlabel('CEFR Level', fontsize=12)
ax2.set_ylabel('Word Rank (1-20,000)', fontsize=12)
ax2.invert_yaxis()

ax3 = axes[1, 0]
for cefr_level in cefr_order:
    if cefr_level in cefr_rank_map:
        data = df_plot[df_plot['cefr_level'] == cefr_level]['word_rank']
        ax3.scatter([cefr_level] * len(data), data, alpha=0.3, s=20, label=cefr_level)
ax3.set_title('CEFR Level vs Word Rank (Scatter Plot)', fontsize=14, fontweight='bold')
ax3.set_xlabel('CEFR Level', fontsize=12)
ax3.set_ylabel('Word Rank (1-20,000)', fontsize=12)
ax3.invert_yaxis()
ax3.legend(title='CEFR Level')

ax4 = axes[1, 1]
cefr_means = df_plot.groupby('cefr_level')['word_rank'].mean().reindex(cefr_order)
cefr_medians = df_plot.groupby('cefr_level')['word_rank'].median().reindex(cefr_order)
x_pos = range(len(cefr_order))
width = 0.35
ax4.bar([p - width/2 for p in x_pos], cefr_means, width, label='Mean Rank', alpha=0.8)
ax4.bar([p + width/2 for p in x_pos], cefr_medians, width, label='Median Rank', alpha=0.8)
ax4.set_title('Average Word Rank by CEFR Level', fontsize=14, fontweight='bold')
ax4.set_xlabel('CEFR Level', fontsize=12)
ax4.set_ylabel('Average Word Rank', fontsize=12)
ax4.set_xticks(x_pos)
ax4.set_xticklabels(cefr_order)
ax4.legend()
ax4.invert_yaxis()

plt.tight_layout()
plot_path = output_dir / "cefr_vs_rank_analysis.png"
plt.savefig(plot_path, dpi=300, bbox_inches='tight')
print(f"\nPlot saved to: {plot_path}")

fig2, ax = plt.subplots(figsize=(12, 8))
for cefr_level in cefr_order:
    if cefr_level in cefr_rank_map:
        data = df_plot[df_plot['cefr_level'] == cefr_level]['word_rank']
        ax.hist(data, bins=50, alpha=0.5, label=cefr_level)
ax.set_title('Distribution of Word Ranks by CEFR Level', fontsize=14, fontweight='bold')
ax.set_xlabel('Word Rank (1-20,000)', fontsize=12)
ax.set_ylabel('Frequency', fontsize=12)
ax.legend(title='CEFR Level')
ax.invert_xaxis()
plt.tight_layout()
hist_path = output_dir / "cefr_rank_distribution.png"
plt.savefig(hist_path, dpi=300, bbox_inches='tight')
print(f"Distribution plot saved to: {hist_path}")

csv_output_path = output_dir / "cefr_rank_data.csv"
df_plot.to_csv(csv_output_path, index=False)
print(f"Data saved to: {csv_output_path}")

print("\n" + "="*80)
print("UNCLASSIFIED WORDS SUMMARY")
print("="*80)
print(f"Words with unknown CEFR only: {len(unknown_cefr)}")
print(f"Words with unknown rank only: {len(unknown_rank)}")
print(f"Words with both unknown: {len(unknown_both)}")

unknown_cefr_path = output_dir / "unknown_cefr_words.txt"
with open(unknown_cefr_path, 'w', encoding='utf-8') as f:
    f.write("Words with Unknown CEFR Level (but known rank)\n")
    f.write("="*60 + "\n\n")
    for word in sorted(unknown_cefr):
        f.write(f"{word}\n")
print(f"\nUnknown CEFR words saved to: {unknown_cefr_path}")

unknown_rank_path = output_dir / "unknown_rank_words.txt"
with open(unknown_rank_path, 'w', encoding='utf-8') as f:
    f.write("Words with Unknown Rank (but known CEFR level)\n")
    f.write("="*60 + "\n\n")
    for word in sorted(unknown_rank):
        f.write(f"{word}\n")
print(f"Unknown rank words saved to: {unknown_rank_path}")

unknown_both_path = output_dir / "unknown_both_words.txt"
with open(unknown_both_path, 'w', encoding='utf-8') as f:
    f.write("Words with Both CEFR and Rank Unknown\n")
    f.write("="*60 + "\n\n")
    for word in sorted(unknown_both):
        f.write(f"{word}\n")
print(f"Unknown both saved to: {unknown_both_path}")

print("\n" + "="*80)
print("WORDS WITH HIGHEST RANKS (RAREST) BY CEFR LEVEL")
print("="*80)

for cefr_level in cefr_order:
    if cefr_level in df_plot['cefr_level'].values:
        level_data = df_plot[df_plot['cefr_level'] == cefr_level]
        top_words = level_data.nlargest(10, 'word_rank')[['word', 'word_rank', 'zipf_score']].drop_duplicates('word')
        
        print(f"\n{cefr_level} Level - Top 10 Rarest Words:")
        print(f"{'Word':<20} {'Rank':<10} {'Zipf Score':<12}")
        print(f"{'-'*20} {'-'*10} {'-'*12}")
        
        for _, row in top_words.iterrows():
            print(f"{row['word']:<20} {row['word_rank']:<10} {row['zipf_score']:<12.2f}")

print("\n" + "="*80)
print("ANALYSIS COMPLETE")
print("="*80)

