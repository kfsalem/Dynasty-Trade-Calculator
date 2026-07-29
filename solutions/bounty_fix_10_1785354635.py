"""
Fantasy Football Roster Valuation Engine
Fixes missing values for K, DEF/DST, and deep bench players from FantasyCalc.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field


# Default baseline values tuned to FantasyCalc's 0-10,000 value scale
DEFAULT_POSITION_FLOORS = {
    "K": 250,
    "DEF": 300,
    "DST": 300,
}
DEFAULT_DEEP_BENCH_FLOOR = 50


@dataclass
class Player:
    id: str
    name: str
    position: str
    team: Optional[str] = None
    value: Optional[float] = None
    projected_points: Optional[float] = None


@dataclass
class RosterSlot:
    slot_name: str  # e.g., "QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BN"
    player: Optional[Player] = None


class ValuationEngine:
    """
    Handles value imputation and normalization for FantasyCalc data.
    """

    def __init__(
        self,
        position_floors: Optional[Dict[str, float]] = None,
        deep_bench_floor: float = DEFAULT_DEEP_BENCH_FLOOR,
    ):
        self.position_floors = position_floors or DEFAULT_POSITION_FLOORS
        self.deep_bench_floor = deep_bench_floor

    def get_player_effective_value(self, player: Player) -> float:
        """
        Calculates the effective display and calculation value for a player.
        
        Rules:
        1. If FantasyCalc provided a non-zero value, use it.
        2. If position is K or DEF/DST, assign positional baseline floor.
        3. If position is a skill player missing from value tables (deep bench),
           assign the deep bench floor value.
        """
        # If value exists and is positive, return directly
        if player.value is not None and player.value > 0:
            return float(player.value)

        pos = (player.position or "").upper().strip()

        # Check for unvalued positional defaults (K, DEF/DST)
        if pos in self.position_floors:
            baseline = self.position_floors[pos]
            # Optional dynamic boost if projected points exist
            if player.projected_points and player.projected_points > 0:
                baseline += min(player.projected_points * 2.0, 100.0)
            return baseline

        # Skill position player on deep bench without market value
        return self.deep_bench_floor

    def normalize_roster(self, players: List[Player]) -> List[Player]:
        """
        Applies effective values across all players on a roster.
        """
        for p in players:
            p.value = self.get_player_effective_value(p)
        return players


class RosterManager:
    """
    Manages roster starter optimization and structure calculations.
    """

    def __init__(self, valuer: Optional[ValuationEngine] = None):
        self.valuer = valuer or ValuationEngine()

    def process_starters_by_position(
        self,
        roster_players: List[Player],
        lineup_slots: List[str]
    ) -> Dict[str, Any]:
        """
        Generates startersByPosition mapping and total value aggregates,
        ensuring K, DEF, and deep bench slots are properly populated.
        """
        normalized_players = self.valuer.normalize_roster(roster_players)

        # Sort available players by value descending
        pool = sorted(normalized_players, key=lambda x: x.value or 0.0, reverse=True)
        assigned_player_ids = set()

        starters_by_position: Dict[str, List[Dict[str, Any]]] = {}
        total_starter_value = 0.0
        total_bench_value = 0.0

        # Dedicated positional slots first (e.g., QB, RB, WR, TE, K, DEF)
        non_flex_slots = [s for s in lineup_slots if s not in ("FLEX", "SUPER_FLEX", "BN")]

        for slot in non_flex_slots:
            starters_by_position.setdefault(slot, [])
            # Find highest valued eligible unassigned player
            eligible = [
                p for p in pool 
                if p.id not in assigned_player_ids and p.position.upper() == slot.upper()
            ]
            if eligible:
                selected = eligible[0]
                assigned_player_ids.add(selected.id)
                starters_by_position[slot].append({
                    "id": selected.id,
                    "name": selected.name,
                    "position": selected.position,
                    "value": selected.value,
                    "is_imputed": selected.position.upper() in ("K", "DEF", "DST") or selected.value == self.valuer.deep_bench_floor
                })
                total_starter_value += selected.value or 0.0

        flex_slots = [s for s in lineup_slots if s in ("FLEX", "SUPER_FLEX")]
        flex_positions = {"RB", "WR", "TE"} if "FLEX" in flex_slots else {"QB", "RB", "WR", "TE"}

        for flex_slot in flex_slots:
            starters_by_position.setdefault(flex_slot, [])
            eligible = [
                p for p in pool
                if p.id not in assigned_player_ids and p.position.upper() in flex_positions
            ]
            if eligible:
                selected = eligible[0]
                assigned_player_ids.add(selected.id)
                starters_by_position[flex_slot].append({
                    "id": selected.id,
                    "name": selected.name,
                    "position": selected.position,
                    "value": selected.value,
                    "is_imputed": selected.value == self.valuer.deep_bench_floor
                })
                total_starter_value += selected.value or 0.0

        bench_players = []
        for p in pool:
            if p.id not in assigned_player_ids:
                total_bench_value += p.value or 0.0
                bench_players.append({
                    "id": p.id,
                    "name": p.name,
                    "position": p.position,
                    "value": p.value
                })

        starters_by_position["BN"] = bench_players

        return {
            "startersByPosition": starters_by_position,
            "totalStarterValue": round(total_starter_value, 2),
            "totalBenchValue": round(total_bench_value, 2),
            "totalRosterValue": round(total_starter_value + total_bench_value, 2),
        }