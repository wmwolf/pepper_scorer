# Debug Test for Screenshot Game

## Game Data from Screenshot
Based on the visible game history:

### Players and Teams:
- **Bloppo Team**: Lisa (player 1), Bill (player 3) 
- **Buttsy Team**: Gina (player 2), Susie (player 4)

### Hands Played:
1. **Hand 1**: Lisa deals, Gina bids 4♦ → Bloppo: 1, Buttsy: 4
2. **Hand 2**: Gina deals, Bill bids 4♥ → Bloppo: 5, Buttsy: 6  
3. **Hand 3**: Bill deals, Susie bids 4♠ → Bloppo: 1, Buttsy: 10 (Yellow bg = forced set)
4. **Hand 4**: Susie deals, Lisa bids 4♥ → Bloppo: 5, Buttsy: 10
5. **Hand 5**: Lisa deals, Bill bids ∅ in ∅ → Bloppo: 9, Buttsy: 10
6. **Hand 6**: Gina deals, Susie bids 5♠ → Bloppo: 19, Buttsy: 15
7. **Hand 7**: Bill deals, Susie bids 5♥ → Bloppo: 21, Buttsy: 10 (Red bg = unforced set)
8. **Hand 8**: Susie deals, Susie bids 6♥ → Bloppo: 22, Buttsy: 4 (Red bg = unforced set)
9. **Hand 9**: Lisa deals, Bill bids ∅ in ♥ → Bloppo: 36, Buttsy: -10 (Red bg = unforced set)
10. **Hand 10**: Gina deals, Susie bids 6♥ → Bloppo: 38, Buttsy: -16 (Red bg = unforced set)
11. **Hand 11**: Bill deals, Bill bids 4♠ → Bloppo: 42, Buttsy: -15

## Analysis

### Sets Count Issues:
**Expected Sets**: 5 total (or 4 excluding forced pepper set)
- Hand 3: Susie set (forced pepper)
- Hand 7: Susie set (unforced)  
- Hand 8: Susie set (unforced)
- Hand 9: Bill set (unforced)
- Hand 10: Susie set (unforced)

**Shown**: 3 sets
**Problem**: Statistics not counting all sets properly

### Streak Analysis:

**Bloppo Team Streak**: Should be 5 (hands 7-11)
- Hand 7: Bloppo scores +2 (defensive set)
- Hand 8: Bloppo scores 0 but defends → Check if this counts
- Hand 9: Bloppo scores +14 (bidding success)  
- Hand 10: Bloppo scores +2 (defensive set)
- Hand 11: Bloppo scores +4 (bidding success)

**Buttsy Team Streak**: Showing 3, need to figure out when
- Looking at Buttsy scoring pattern, hard to see any 3-hand streak

## Likely Issues:
1. **Sets calculation** missing some set types
2. **Streak calculation** may have logic errors in determining when teams "win points"
3. **Team mapping** might be incorrect (players to teams)

## Next Steps:
1. Fix sets calculation to count all set types
2. Debug streak calculation with actual hand data
3. Verify team assignments are correct