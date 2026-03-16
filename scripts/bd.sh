#!/bin/bash

COMMAND=$1
shift

case "$COMMAND" in
    "onboard")
        echo "✅ Authenticated with GitHub."
        gh auth status || echo "⚠️ Please run: gh auth login"
        echo "✅ bd (beads) system initialized for Agent Orchestrator."
        ;;
    "ready")
        echo "🔍 Fetching available work (Open Issues)..."
        gh issue list --state open --limit 10
        ;;
    "show")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        gh issue view "$ISSUE_ID"
        ;;
    "update")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        echo "🔄 Marking issue #$ISSUE_ID as in_progress..."
        gh issue edit "$ISSUE_ID" --add-label "in progress" 2>/dev/null || true
        gh issue assign "$ISSUE_ID" --me 2>/dev/null || true
        echo "✅ Issue updated."
        ;;
    "close")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        gh issue close "$ISSUE_ID" --reason completed
        echo "✅ Issue #$ISSUE_ID closed."
        ;;
    "sync")
        echo "🛫 Landing the plane... Initiating sync sequence."
        
        # [AUTOPILOT V1 HOOK] - Guardrails
        echo "⏳ Running pre-sync checks..."
        
        git pull --rebase origin $(git branch --show-current) || { echo "❌ Rebase failed. Fix conflicts and retry."; exit 1; }
        
        if [[ -n $(git status -s) ]]; then
            echo "📝 Found uncommitted changes. Committing..."
            git add .
            git commit -m "Auto-sync from agent session"
        fi

        echo "🚀 Pushing to remote..."
        git push origin $(git branch --show-current) || { echo "❌ Push failed."; exit 1; }
        
        echo "✅ Sync complete. Work safely landed."
        ;;
    *)
        echo "Usage: bd [onboard|ready|show <id>|update <id> --status in_progress|close <id>|sync]"
        exit 1
        ;;
esac
