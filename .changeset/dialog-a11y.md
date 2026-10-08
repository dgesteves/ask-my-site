---
'ask-my-site': patch
---

Fix two accessibility failures axe found in the dialog. Once an answer showed, the input's `aria-controls` pointed at a list that was no longer rendered; the list now stays mounted, hidden and empty, while the answer shows. The `--ask-subtle` color (the sources heading, source URLs and the footer) had a 3.74:1 contrast in the light theme and 4.45:1 in the dark one; it is now `#687280` and `#7c8796`, above 4.5:1 on both the dialog and its raised surfaces. Sources the answer does not cite are de-emphasized with color instead of `opacity: 0.55`, which took their text below 4.5:1 too.
