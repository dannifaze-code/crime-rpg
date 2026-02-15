Character Forge UI Skinning
===========================

Drop replacement PNGs here using the same filenames to reskin UI without code changes.

Expected files by subfolder:

frame/
  frame.png              - Main overlay frame / border

icons/
  tab_create.png         - "Create" tab icon (overlay sidebar + category card)
  tab_wardrobe.png       - "Wardrobe" tab icon (overlay sidebar + category card)
  tab_armor.png          - "Armor" tab icon (overlay sidebar + category card)
  tab_animals.png        - "Animals" tab icon (overlay sidebar + category card)

panels/
  panel_bg.png           - Bottom context panel background
  card_bg.png            - Item card background + category card background

buttons/
  btn_back.png           - Back / close button
  btn_confirm.png        - Confirm / save button
  btn_arrow_left.png     - Left pagination arrow
  btn_arrow_right.png    - Right pagination arrow

textures/
  stage_bg.png           - Character stage background texture

All images should be PNG with transparency where appropriate.
The UI will fall back to CSS gradients if any image fails to load.
