# Pepper Scorer Awards

## Achievement Awards

* **Trump Master**
  * Description: Most consistently successful when calling trump suits
  * Technical: Highest percentage of successful bids where trump was called (excluding NT), minimum 3 bids

* **Clutch Player**
  * Description: Most bids made that pushed their team over 42 points to win
  * Technical: Count of winning bids where team score was < 42 before hand and ≥ 42 after hand

* **Defensive Specialist**
  * Description: Most successful sets when defending
  * Technical: Count of hands where player was on defending team, chose to play, and bidding team went set

* **Efficient Bidder**
  * Description: Highest ratio of points earned to tricks bid
  * Technical: Total points earned from successful bids divided by total tricks bid (min 5 bids)

* **Perfect Pepper**
  * Description: Made all their pepper round bids successfully
  * Technical: In hands[0:3], all hands where player was bidder (position = current_dealer + 1) were successful

* **Club Champion**
  * Description: Highest success rate with club bids
  * Technical: Percentage of successful bids where trump was clubs, minimum 3 club bids

* **Negotiator**
  * Description: Most successful free trick negotiations
  * Technical: Count of hands where player's team was defending and hand ended with 'F1' or 'F2'

## Style Awards

* **Risk Taker**
  * Description: Most bids made when team was behind by 10+ points
  * Technical: Count of bids made when bidder's team score was at least 10 points below other team's score

* **All or Nothing**
  * Description: Only bid pepper/four or moon/double moon
  * Technical: All bids by player were either 'P'/'4' or 'M'/'D', minimum 5 bids

* **Table Talk Champion**
  * Description: Most times asking for free tricks
  * Technical: Count of hands where player's team was defending and hand ended with 'F1' or 'F2'

* **Creature of Habit**
  * Description: Highest percentage of bids in a single suit
  * Technical: Highest percentage of bids in any one suit, minimum 5 bids

* **Early Bird**
  * Description: Most bids won as first bidder after dealer
  * Technical: Count of winning bids where bidder position was (dealer_position + 1) % 4

* **Fashionably Late**
  * Description: Most winning bids made as last possible bidder
  * Technical: Count of winning bids where bidder position was (dealer_position + 3) % 4

## Dubious Distinction Awards

* **Moon Struck**
  * Description: Most failed moon/double moon attempts
  * Technical: Count of failed bids where bid was 'M' or 'D'

* **Overachiever**
  * Description: Highest average bid value in failed bids
  * Technical: Average numeric value of failed bids (4=4, 5=5, 6=6, M=7, D=14), minimum 3 failed bids

* **False Confidence**
  * Description: Most failed no-trump bids
  * Technical: Count of failed bids where trump was 'N'

* **Gambling Problem**
  * Description: Most sets when could have negotiated
  * Technical: Count of hands where player's team defended, played ('P'), went set, and bid was 4 or 5

* **Team Player...For The Other Team**
  * Description: Most points lost to sets
  * Technical: Total points lost from failed bids and defensive sets

* **Pepper Shaker**
  * Description: Failed more pepper round bids than successful ones
  * Technical: In hands[0:3], count of failed bids > count of successful bids

## Notes on Implementation

1. For all percentage-based awards, establish minimum thresholds to avoid edge cases (e.g., someone who bid once and succeeded getting 100%)

2. When counting bids/plays, remember that players alternate between bidding and supporting teams

3. For series play, these statistics should be accumulated across all games in the series

4. Some awards might be withheld if no player meets minimum thresholds

5. Consider tracking "almost won" awards where a player was close to winning multiple categories