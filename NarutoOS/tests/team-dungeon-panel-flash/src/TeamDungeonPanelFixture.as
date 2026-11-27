package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import narutoos.daily.TeamDungeonPanel;
    import com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon.TeamNewDungeonPanel;
    import com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon.TeamNewDungeonItemRenderer;
    import com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon.EnterConfirmWindow;
    import serverProto.dungeon.ProtoNewTeamDungeonState;

    public final class TeamDungeonPanelFixture extends Sprite
    {
        private var panel:TeamNewDungeonPanel;
        private var confirm:EnterConfirmWindow;

        private function get renderer():TeamNewDungeonItemRenderer { return panel != null ? panel.currentRenderer : null; }

        public function TeamDungeonPanelFixture()
        {
            ExternalInterface.addCallback("perform", perform);
            reset("ready");
            ExternalInterface.call("fixtureReady");
        }

        public function perform(action:String):Object
        {
            if (action == "ready" || action == "recommendEasy" || action == "recommendHard" ||
                action == "hardLocked" || action == "empty")
            {
                reset(action);
            }
            var chosen:Object = TeamDungeonPanel.choose(panel);
            var confirmButton:Object = TeamDungeonPanel.confirmButton(confirm);
            return {
                kind:chosen.kind,
                message:chosen.message,
                dungeonId:chosen.dungeonId,
                frame:renderer != null ? renderer.skin.selector.difficulty.currentFrame : 0,
                nextClicks:renderer != null ? renderer.nextClicks : 0,
                tabIndex:panel.content.tabMc.selectedIndex,
                readyButtonMatches:renderer != null && chosen.button === renderer.skin.picBtn,
                confirmButtonMatches:confirmButton === confirm.confirmBtn,
                confirmLabel:confirm.confirmBtn.label,
                cancelLabel:confirm.cancelBtn.label
            };
        }

        private function reset(scenario:String):void
        {
            if (panel != null && panel.parent != null) removeChild(panel);
            if (confirm != null && confirm.parent != null) removeChild(confirm);
            panel = new TeamNewDungeonPanel();
            confirm = new EnterConfirmWindow();
            confirm.x = 320;
            addChild(panel);
            addChild(confirm);

            if (scenario == "recommendEasy")
            {
                var recommended:TeamNewDungeonItemRenderer = new TeamNewDungeonItemRenderer({
                    isCommandData:true,
                    curDifficulty:1,
                    teamNewDungeonInfoAry:[info(101, 1, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_RECOMMEND, 10)]
                });
                panel.setPages([recommended], [hardCard()]);
            }
            else if (scenario == "recommendHard")
            {
                var recommendedHard:TeamNewDungeonItemRenderer = new TeamNewDungeonItemRenderer({
                    isCommandData:true,
                    curDifficulty:3,
                    teamNewDungeonInfoAry:[null, null,
                        info(303, 3, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_RECOMMEND, 65)]
                });
                panel.setPages([recommendedHard], []);
            }
            else if (scenario == "empty")
            {
                panel.setPages([], [hardCard()]);
            }
            else if (scenario == "hardLocked")
            {
                var locked:TeamNewDungeonItemRenderer = new TeamNewDungeonItemRenderer({
                        isCommandData:false,
                        curDifficulty:2,
                        teamNewDungeonInfoAry:[
                            info(101, 1, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_HAS_OPEN, 10),
                            info(202, 2, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_HAS_OPEN, 20),
                            info(303, 3, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_NOT_OPEN, 65)
                        ]
                    });
                panel.setPages([locked], [locked]);
            }
            else
            {
                // The native renderer groups difficulty rows in one card. Different backend
                // dungeon IDs per difficulty are valid; selection must stay on this renderer.
                panel.setPages([hardCard()], [hardCard()]);
            }
        }

        private function hardCard():TeamNewDungeonItemRenderer
        {
            return new TeamNewDungeonItemRenderer({
                isCommandData:false,
                curDifficulty:1,
                teamNewDungeonInfoAry:[
                    info(101, 1, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_HAS_OPEN, 10),
                    info(202, 2, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_HAS_OPEN, 20),
                    info(303, 3, ProtoNewTeamDungeonState.PROTO_NEW_TEAM_DUNGEON_STATE_RECOMMEND, 65)
                ]
            });
        }

        private function info(id:int, difficulty:int, state:int, power:int):Object
        {
            return {dungeonId:id, difficultyType:difficulty, state:state, conf:{combatPower:power}};
        }
    }
}
