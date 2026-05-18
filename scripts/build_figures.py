"""Build static SVG illustrations for the section pages.

Outputs go to generated/figures/<name>.svg. All eight figures share a
common neutral palette tuned to read on both light and dark backgrounds
(strokes and labels use middle greys; the teal accent matches the site).

Figures are referenced from section.html via a section-id → figures map.

Usage:
    python scripts/build_figures.py
    python scripts/build_figures.py --only efficient-frontier
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR   = REPO_ROOT / "generated" / "figures"

# ─────────── Palette (resolved CSS variables) ───────────
PRIMARY      = "#094459"   # var(--primary)
PRIMARY_MID  = "#157caa"   # var(--primary-mid)
PRIMARY_LIGHT= "#87c3da"   # var(--primary-light)
INK          = "#0f1722"
INK_SOFT     = "#4a5360"
INK_FADED    = "#7c8593"
WARM         = "#b35c2a"
OK           = "#2d7d6b"
HIGHLIGHT    = "#b07a1c"


def figure(width_in=5.6, height_in=3.4):
    """Set up a stylistically consistent matplotlib figure."""
    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=110)
    fig.patch.set_alpha(0)        # transparent background; site bg shows
    ax.set_facecolor("none")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(INK_SOFT)
        ax.spines[s].set_linewidth(0.8)
    ax.tick_params(axis="both", colors=INK_SOFT, labelsize=9, length=3)
    ax.xaxis.label.set_color(INK)
    ax.yaxis.label.set_color(INK)
    ax.title.set_color(INK)
    plt.rcParams["font.family"] = ["Helvetica", "Arial", "DejaVu Sans"]
    return fig, ax


def save(fig, name: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.svg"
    fig.tight_layout(pad=0.6)
    fig.savefig(path, format="svg", transparent=True, bbox_inches="tight")
    plt.close(fig)
    return path


# ─────────────────────────────────────────────────────────────────────
# 1. Efficient frontier + CML (section_04)
# ─────────────────────────────────────────────────────────────────────
def fig_efficient_frontier():
    fig, ax = figure(6.2, 3.8)

    # Parametric hyperbola in (sigma, mu) space.
    # Approximation: mu(sigma) = a + b * sqrt(sigma^2 - sigma_min^2)
    sigma_min = 0.10
    mu_mv     = 0.06
    b         = 0.6
    sig = np.linspace(sigma_min, 0.40, 200)
    upper = mu_mv + b * np.sqrt(sig**2 - sigma_min**2)
    lower = mu_mv - b * np.sqrt(sig**2 - sigma_min**2)

    ax.plot(sig, upper, color=PRIMARY, lw=2.2, label="Efficient frontier")
    ax.plot(sig, lower, color=PRIMARY_LIGHT, lw=1.3, ls="--",
            label="Inefficient (dominated)")

    # Capital Market Line: tangent through (0, rf) to the upper branch.
    rf = 0.03
    # Numerically find tangent point: maximise Sharpe ratio
    sharpe = (upper - rf) / sig
    k = int(np.argmax(sharpe))
    sig_m, mu_m = sig[k], upper[k]
    slope = (mu_m - rf) / sig_m
    x_cml = np.array([0.0, 0.42])
    y_cml = rf + slope * x_cml
    ax.plot(x_cml, y_cml, color=WARM, lw=2, label="Capital Market Line")

    # Annotation points
    ax.plot([0], [rf], "o", color=INK, ms=5, zorder=5)
    ax.annotate(r"$r_f$", (0, rf), xytext=(6, -3),
                textcoords="offset points", color=INK_SOFT, fontsize=10)
    ax.plot([sig_m], [mu_m], "o", color=WARM, ms=7, zorder=5)
    ax.annotate("Market portfolio", (sig_m, mu_m),
                xytext=(8, -4), textcoords="offset points",
                color=INK, fontsize=10, fontweight="bold")
    ax.plot([sigma_min], [mu_mv], "o", color=INK_FADED, ms=5, zorder=5)
    ax.annotate("Min-variance\nportfolio", (sigma_min, mu_mv),
                xytext=(-44, -28), textcoords="offset points",
                color=INK_SOFT, fontsize=8.5, ha="left")

    # Scatter a few individual assets
    rng = np.random.default_rng(7)
    asset_sig = rng.uniform(0.15, 0.38, 9)
    asset_mu  = mu_mv + b * 0.55 * np.sqrt(asset_sig**2 - sigma_min**2) \
                + rng.normal(0, 0.012, 9)
    ax.scatter(asset_sig, asset_mu, s=22, color=INK_FADED, alpha=0.7,
               label="Individual assets")

    ax.set_xlabel(r"Standard deviation  $\sigma$  (risk)")
    ax.set_ylabel(r"Expected return  $E[R]$")
    ax.set_xlim(0, 0.42)
    ax.set_ylim(0, 0.20)
    ax.legend(loc="lower right", fontsize=8.5, frameon=False,
              labelcolor=INK_SOFT)
    return save(fig, "efficient-frontier")


# ─────────────────────────────────────────────────────────────────────
# 2. Security Market Line (sections 4/5/9)
# ─────────────────────────────────────────────────────────────────────
def fig_sml():
    fig, ax = figure(6.0, 3.6)

    rf = 0.03
    rm = 0.10
    beta = np.linspace(-0.2, 2.0, 200)
    sml  = rf + beta * (rm - rf)
    ax.plot(beta, sml, color=PRIMARY, lw=2.2, label="Security Market Line")

    # Reference points
    pts = [
        (0.0, rf,  r"$r_f$",         INK_SOFT),
        (1.0, rm,  "Market",         WARM),
        (0.4, rf + 0.4*(rm-rf), "Low-β",  OK),
        (1.6, rf + 1.6*(rm-rf), "High-β", HIGHLIGHT),
    ]
    for b, r, lbl, col in pts:
        ax.plot([b], [r], "o", color=col, ms=7, zorder=5)
        ax.annotate(lbl, (b, r), xytext=(7, -3),
                    textcoords="offset points",
                    color=INK, fontsize=10, fontweight="bold")

    # Above-line: undervalued; below: overvalued
    ax.scatter([0.7], [rf + 0.7*(rm-rf) + 0.022], color=OK, s=40, zorder=5, marker="^")
    ax.annotate("Underpriced\n(above SML)", (0.7, rf+0.7*(rm-rf)+0.022),
                xytext=(8, 0), textcoords="offset points",
                fontsize=8.5, color=OK)
    ax.scatter([1.3], [rf + 1.3*(rm-rf) - 0.025], color=WARM, s=40, zorder=5, marker="v")
    ax.annotate("Overpriced\n(below SML)", (1.3, rf+1.3*(rm-rf)-0.025),
                xytext=(8, -12), textcoords="offset points",
                fontsize=8.5, color=WARM)

    ax.axhline(rf, color=INK_FADED, lw=0.6, ls=":")
    ax.set_xlabel(r"Beta  $\beta$  (systematic risk)")
    ax.set_ylabel(r"Expected return  $E[R]$")
    ax.set_xlim(-0.2, 2.0)
    ax.set_ylim(0, 0.22)
    return save(fig, "sml")


# ─────────────────────────────────────────────────────────────────────
# 3. Yield curve shapes (section_01, section_02)
# ─────────────────────────────────────────────────────────────────────
def fig_yield_curve():
    fig, ax = figure(6.0, 3.4)
    t = np.linspace(0.25, 20, 200)

    normal = 0.018 + 0.025 * (1 - np.exp(-t/4.5))
    flat   = 0.038 + 0.0 * t
    inv    = 0.052 - 0.024 * (1 - np.exp(-t/5))

    ax.plot(t, normal, color=PRIMARY,  lw=2.2, label="Normal (upward sloping)")
    ax.plot(t, flat,   color=INK_FADED, lw=1.8, ls="--", label="Flat")
    ax.plot(t, inv,    color=WARM,     lw=2.2, label="Inverted (downward sloping)")

    ax.set_xlabel("Maturity  (years)")
    ax.set_ylabel("Spot rate  $r_t$")
    ax.set_xlim(0, 20)
    ax.set_ylim(0, 0.07)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v*100:.0f}%"))
    ax.legend(loc="lower right", fontsize=9, frameon=False,
              labelcolor=INK_SOFT)
    return save(fig, "yield-curve")


# ─────────────────────────────────────────────────────────────────────
# 4. Option payoff diagrams (section_10)
# ─────────────────────────────────────────────────────────────────────
def fig_option_payoffs():
    fig, axes = plt.subplots(1, 2, figsize=(7.6, 3.4), dpi=110)
    fig.patch.set_alpha(0)

    S = np.linspace(0, 100, 200)
    K = 50
    premium = 6

    for ax in axes:
        ax.set_facecolor("none")
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color(INK_SOFT); ax.spines[s].set_linewidth(0.8)
        ax.tick_params(axis="both", colors=INK_SOFT, labelsize=9)
        ax.axhline(0, color=INK_FADED, lw=0.6)

    # Long call: payoff = max(S-K, 0); profit = payoff - premium
    call_pay  = np.maximum(S - K, 0)
    call_prof = call_pay - premium
    axes[0].plot(S, call_pay,  color=PRIMARY, lw=2.2, label="Payoff at expiry")
    axes[0].plot(S, call_prof, color=PRIMARY_MID, lw=1.8, ls="--", label=f"Profit (premium = {premium})")
    axes[0].axvline(K, color=INK_FADED, lw=0.6, ls=":")
    axes[0].annotate(f"$K = {K}$", (K, 2), xytext=(4, 0),
                     textcoords="offset points", color=INK_SOFT, fontsize=9)
    axes[0].set_title("Long call", color=INK, fontsize=12, fontweight="bold", pad=10)
    axes[0].set_xlabel(r"Underlying price at expiry  $S_T$")
    axes[0].set_ylabel("Payoff / Profit")
    axes[0].legend(loc="upper left", fontsize=8.5, frameon=False, labelcolor=INK_SOFT)

    # Long put
    put_pay  = np.maximum(K - S, 0)
    put_prof = put_pay - premium
    axes[1].plot(S, put_pay,  color=PRIMARY, lw=2.2, label="Payoff at expiry")
    axes[1].plot(S, put_prof, color=PRIMARY_MID, lw=1.8, ls="--", label=f"Profit (premium = {premium})")
    axes[1].axvline(K, color=INK_FADED, lw=0.6, ls=":")
    axes[1].annotate(f"$K = {K}$", (K, 2), xytext=(4, 0),
                     textcoords="offset points", color=INK_SOFT, fontsize=9)
    axes[1].set_title("Long put", color=INK, fontsize=12, fontweight="bold", pad=10)
    axes[1].set_xlabel(r"Underlying price at expiry  $S_T$")
    axes[1].legend(loc="upper right", fontsize=8.5, frameon=False, labelcolor=INK_SOFT)

    for ax in axes:
        ax.set_xlim(0, 100); ax.set_ylim(-15, 55)

    fig.tight_layout(pad=0.6)
    out = OUT_DIR / "option-payoffs.svg"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", transparent=True, bbox_inches="tight")
    plt.close(fig)
    return out


# ─────────────────────────────────────────────────────────────────────
# 5. Binomial option pricing tree (section_10/11)
# ─────────────────────────────────────────────────────────────────────
def fig_binomial_tree():
    fig, ax = figure(6.2, 3.8)
    ax.set_axis_off()

    # Two-period recombining tree.
    S0, u, d = 50, 1.25, 0.80
    nodes = {
        (0, 0): S0,
        (1, 1): S0 * u,
        (1, 0): S0 * d,
        (2, 2): S0 * u * u,
        (2, 1): S0 * u * d,
        (2, 0): S0 * d * d,
    }
    # Positions: x = step, y centred around 0
    pos = {}
    for (t, k), v in nodes.items():
        pos[(t, k)] = (t, (k - t/2) * 1.6)

    # Edges (parent → up, parent → down)
    edges = [
        ((0,0), (1,1), "u"),
        ((0,0), (1,0), "d"),
        ((1,1), (2,2), "u"),
        ((1,1), (2,1), "d"),
        ((1,0), (2,1), "u"),
        ((1,0), (2,0), "d"),
    ]
    for a, b, lbl in edges:
        x1, y1 = pos[a]; x2, y2 = pos[b]
        ax.plot([x1, x2], [y1, y2], color=INK_FADED, lw=1.2, zorder=1)
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my + (0.08 if lbl == "u" else -0.08), lbl,
                color=PRIMARY if lbl == "u" else WARM,
                fontsize=10, fontweight="bold", ha="center",
                va="bottom" if lbl == "u" else "top")

    # Nodes
    for (t, k), v in nodes.items():
        x, y = pos[(t, k)]
        ax.add_patch(plt.Circle((x, y), 0.22, color="white",
                                ec=PRIMARY, lw=1.8, zorder=3))
        ax.text(x, y, f"${v:g}", ha="center", va="center",
                fontsize=10, color=INK, fontweight="bold", zorder=4)

    # Parameter box
    ax.text(0.05, -1.55, f"$S_0 = {S0}$,  $u = {u}$,  $d = {d}$,  "
            r"two periods",
            transform=ax.get_yaxis_transform() if False else None,
            color=INK_SOFT, fontsize=9.5)

    ax.set_xlim(-0.4, 2.6)
    ax.set_ylim(-1.7, 1.8)
    ax.set_title("Two-step recombining binomial tree",
                 color=INK, fontsize=11, fontweight="bold", pad=6, loc="left")
    return save(fig, "binomial-tree")


# ─────────────────────────────────────────────────────────────────────
# 6. MM trade-off theory (section_07)
# ─────────────────────────────────────────────────────────────────────
def fig_mm_tradeoff():
    fig, ax = figure(6.2, 3.6)

    D = np.linspace(0, 1.0, 200)        # leverage ratio D/(D+E)
    V_U = 1.0                            # unlevered firm value (normalised)
    tc  = 0.25                           # tax rate
    # Tax shield gain (linear): tc * D
    shield = tc * D
    # Expected bankruptcy / distress cost (convex, kicks in past ~40% leverage)
    distress = 0.55 * np.maximum(D - 0.35, 0)**2.4
    V_L = V_U + shield - distress

    ax.plot(D, [V_U]*len(D), color=INK_FADED, lw=1.4, ls=":",
            label="MM no-tax: $V_L = V_U$")
    ax.plot(D, V_U + shield, color=OK, lw=1.8, ls="--",
            label="MM with taxes: $V_L = V_U + t_c D$")
    ax.plot(D, V_L, color=PRIMARY, lw=2.4,
            label="Trade-off: tax shield − distress cost")

    k = int(np.argmax(V_L))
    D_star, V_star = D[k], V_L[k]
    ax.plot([D_star], [V_star], "o", color=WARM, ms=8, zorder=5)
    ax.annotate("Optimal capital\nstructure $D^*$",
                (D_star, V_star), xytext=(8, -2),
                textcoords="offset points",
                color=INK, fontsize=10, fontweight="bold")
    ax.axvline(D_star, color=INK_FADED, lw=0.5, ls=":")

    ax.set_xlabel(r"Leverage  $D / (D + E)$")
    ax.set_ylabel("Firm value  $V_L$  (normalised)")
    ax.set_xlim(0, 1)
    ax.set_ylim(0.7, 1.35)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v*100:.0f}%"))
    ax.legend(loc="lower center", fontsize=8.5, frameon=False,
              labelcolor=INK_SOFT, bbox_to_anchor=(0.5, -0.30), ncol=1)
    fig.subplots_adjust(bottom=0.30)
    return save(fig, "mm-tradeoff")


# ─────────────────────────────────────────────────────────────────────
# 7. NPV profile (section_02)
# ─────────────────────────────────────────────────────────────────────
def fig_npv_profile():
    fig, ax = figure(6.0, 3.4)
    r = np.linspace(0, 0.30, 300)
    cash_flows = [-100, 30, 40, 50, 35]    # year 0..4
    npv = sum(cf / (1 + r)**t for t, cf in enumerate(cash_flows))

    ax.plot(r, npv, color=PRIMARY, lw=2.2, label=r"NPV($r$)")
    ax.axhline(0, color=INK_FADED, lw=0.7)

    # IRR: where NPV crosses zero
    sign = np.sign(npv)
    crossing = np.where(np.diff(sign) != 0)[0]
    if len(crossing):
        i = crossing[0]
        # Linear interpolation for the crossing point
        r0, r1 = r[i], r[i+1]
        n0, n1 = npv[i], npv[i+1]
        irr = r0 - n0 * (r1 - r0) / (n1 - n0)
        ax.plot([irr], [0], "o", color=WARM, ms=8, zorder=5)
        ax.annotate(f"IRR ≈ {irr*100:.1f}%", (irr, 0),
                    xytext=(8, 8), textcoords="offset points",
                    color=INK, fontsize=10, fontweight="bold")

    ax.set_xlabel(r"Discount rate  $r$")
    ax.set_ylabel("Net Present Value")
    ax.set_xlim(0, 0.30)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v*100:.0f}%"))
    return save(fig, "npv-profile")


# ─────────────────────────────────────────────────────────────────────
# 8. Decision tree — real option to delay (section_11)
# ─────────────────────────────────────────────────────────────────────
def fig_decision_tree():
    fig, ax = figure(6.6, 3.8)
    ax.set_axis_off()

    # Layout: square decision node → two branches (Invest now / Wait)
    # "Wait" further branches into "high state" / "low state".
    def node(x, y, kind, label):
        if kind == "decision":
            sz = 0.32
            ax.add_patch(plt.Rectangle((x-sz/2, y-sz/2), sz, sz,
                                       facecolor="white", edgecolor=PRIMARY, lw=1.8))
        else:  # chance
            ax.add_patch(plt.Circle((x, y), 0.18, facecolor="white",
                                    edgecolor=WARM, lw=1.8))
        ax.text(x, y - 0.32, label, ha="center", va="top",
                color=INK_SOFT, fontsize=9)

    # Root (decision)
    node(0, 0, "decision", "Decide now")
    # Invest now branch (leaf)
    ax.plot([0.2, 1.8], [0.1, 0.7], color=INK_FADED, lw=1.2)
    ax.text(1.0, 0.45, "Invest now", color=PRIMARY, fontsize=10,
            fontweight="bold", ha="center", va="bottom")
    ax.text(1.95, 0.7, r"$\text{NPV}_0 = +5$",
            color=INK, fontsize=10, va="center")

    # Wait branch → chance node at (1.8, -0.6)
    ax.plot([0.2, 1.8], [-0.1, -0.6], color=INK_FADED, lw=1.2)
    ax.text(1.0, -0.42, "Wait one year", color=PRIMARY, fontsize=10,
            fontweight="bold", ha="center", va="bottom")
    node(1.8, -0.6, "chance", "Year 1 reveals demand")

    # Chance → two leaves
    ax.plot([2.0, 3.5], [-0.5, -0.1], color=INK_FADED, lw=1.2)
    ax.plot([2.0, 3.5], [-0.7, -1.1], color=INK_FADED, lw=1.2)
    ax.text(2.7, -0.27, "High demand  $(p = 0.5)$",
            color=OK,    fontsize=9, ha="center")
    ax.text(2.7, -0.88, "Low demand  $(1{-}p = 0.5)$",
            color=WARM,  fontsize=9, ha="center")
    ax.text(3.7, -0.1, r"Invest:  $\text{NPV}_1^H = +18$",
            color=INK, fontsize=10, va="center")
    ax.text(3.7, -1.1, r"Walk away:  $\text{NPV}_1^L = 0$",
            color=INK, fontsize=10, va="center")

    # EV calculation strip
    ax.text(0, -1.55,
            r"$\text{EV(wait)} = \dfrac{0.5\cdot 18 + 0.5\cdot 0}{1 + r} = 8.18 \;>\; 5$",
            color=INK, fontsize=10, ha="left")
    ax.text(0, -1.85, "→ delaying is optimal when the option to wait is valuable",
            color=INK_SOFT, fontsize=9, ha="left", style="italic")

    ax.set_xlim(-0.5, 6.4)
    ax.set_ylim(-2.1, 1.0)
    return save(fig, "decision-tree")


# ─────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────
FIGS = {
    "efficient-frontier": fig_efficient_frontier,
    "sml":                fig_sml,
    "yield-curve":        fig_yield_curve,
    "option-payoffs":     fig_option_payoffs,
    "binomial-tree":      fig_binomial_tree,
    "mm-tradeoff":        fig_mm_tradeoff,
    "npv-profile":        fig_npv_profile,
    "decision-tree":      fig_decision_tree,
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", help="build only this figure id", default=None)
    args = ap.parse_args()
    ids = [args.only] if args.only else list(FIGS)
    for fid in ids:
        if fid not in FIGS:
            raise SystemExit(f"Unknown figure id: {fid}. Pick from {list(FIGS)}.")
        out = FIGS[fid]()
        print(f"  wrote {out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
