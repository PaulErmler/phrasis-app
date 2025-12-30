# Practice Mode Considerations for Spaced Repetition

## The Challenge
When users have no cards due for review but want to continue practicing, how should "practice anyway" sessions interact with the FSRS (Free Spaced Repetition Scheduler) algorithm?

## Three Possible Approaches

### Option 1: Practice Without Recording
**How it works:**
- Users can practice any card at any time
- Reviews during practice mode are NOT recorded in the FSRS system
- The card's scheduling remains unchanged
- No impact on the scientifically-designed spacing intervals

**Pros:**
- Preserves the integrity of the spaced repetition algorithm
- Allows guilt-free extra practice
- Keeps "due" reviews (scientifically scheduled) separate from voluntary practice
- Users can practice as much as they want without messing up their schedule

**Cons:**
- Practice sessions don't contribute to the learning algorithm
- If a user genuinely struggles with a card in practice mode, it won't be scheduled sooner

**Best for:**
- Users who want extra practice without affecting their schedule
- Maintaining scientific accuracy of the SRS algorithm
- Reducing pressure - practice is just for fun/reinforcement

---

### Option 2: Penalty-Only Recording
**How it works:**
- Only record reviews when users mark "Again" or "Hard"
- "Good" and "Easy" ratings in practice mode are ignored
- Struggling cards get brought back into rotation sooner
- Well-known cards aren't pushed further out

**Pros:**
- Catches cards the user is struggling with
- Doesn't artificially inflate good performance
- Partially preserves the schedule for known cards

**Cons:**
- Still modifies the algorithm, just less aggressively
- May create inconsistent data (only recording some reviews)
- More complex logic to maintain

**Best for:**
- Users who want a middle ground
- Catching problem cards during extra practice

---

### Option 3: Full Recording
**How it works:**
- Record everything normally during practice mode
- Extra practice sessions push cards further out in the schedule
- Treats practice the same as scheduled reviews

**Pros:**
- Simplest implementation
- Reflects actual knowledge and exposure
- No special cases or modes to track

**Cons:**
- Extra practice artificially inflates card intervals
- May push cards too far into the future
- Defeats the scientific spacing of the algorithm
- Users may feel discouraged from practicing if it affects their schedule

**Best for:**
- Users who want all practice to count equally
- Simpler systems without strict SRS adherence

---

## Implementation Decision: Option 1

We chose **Option 1 (Practice Without Recording)** because:

1. **Preserves Science**: The FSRS algorithm is research-based and works best when the intervals are respected
2. **Encourages Practice**: Users can practice as much as they want without worrying about "messing up" their schedule
3. **Clear Separation**: "Due reviews" (science) vs "Practice" (fun/extra learning)
4. **User Experience**: Shows a visual indicator "🎮 Practice Mode - Not affecting your schedule" so users understand what's happening

### Visual Indicators
- Practice mode badge at the top of the page
- Different color scheme (purple instead of blue) to distinguish practice from reviews
- Clear messaging about what mode the user is in

### User Control
- "Practice All Cards Anyway" button appears when no cards are due
- Button to exit practice mode and return to scheduled reviews at any time
