/**
 * @name RightClickJoin
 * @author Farcrada
 * @version 1.1.6
 * @description Right click a user to join a voice channel they are in.
 * 
 * @website https://github.com/Farcrada/DiscordPlugins
 * @source https://github.com/Farcrada/DiscordPlugins/blob/master/Right-Click-Join/RightClickJoin.plugin.js
 * @updateUrl https://raw.githubusercontent.com/Farcrada/DiscordPlugins/master/Right-Click-Join/RightClickJoin.plugin.js
 */


const config = {
    info: {
        name: "Right Click Join",
        id: "RightClickJoin",
        description: "Right click a user to join a voice channel they are in.",
        version: "1.1.6",
        author: "Farcrada",
        updateUrl: "https://raw.githubusercontent.com/Farcrada/DiscordPlugins/master/Right-Click-Join/RightClickJoin.plugin.js"
    }
}


class RightClickJoin {
    getName() { return config.info.name; }
    getDescription() { return config.info.description; }
    getVersion() { return config.info.version; }
    getAuthor() { return config.info.author; }

    start() {
        if (!global.ZeresPluginLibrary) {
            BdApi.showConfirmationModal("Library Missing", `The library plugin needed for ${this.getName()} is missing. Please click Download Now to install it.`, {
                confirmText: "Download Now",
                cancelText: "Cancel",
                onConfirm: () => {
                    require("request").get("https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js",
                        async (error, response, body) => {
                            if (error)
                                return require("electron").shell.openExternal("https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js");
                            await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), body, r));
                        });
                }
            });
        }

        //First try the updater
        try {
            global.ZeresPluginLibrary.PluginUpdater.checkForUpdate(config.info.name, config.info.version, config.info.updateUrl);
        }
        catch (err) {
            console.error(this.getName(), "Plugin Updater could not be reached.", err);
        }

        //Now try to initialize.
        try {
            this.initialize();
        }
        catch (err) {
            try {
                console.error("Attempting to stop after initialization error...")
                this.stop();
            }
            catch (err) {
                console.error(this.getName() + ".stop()", err);
            }
        }
    }

    initialize() {
        //Create our cache
        createCache();

        //Patch the guild context menu
        patchGuildChannelUserContextMenu();
        //And since it would be handy to join from a DM, it works differently.
        patchDMUserContextMenu();
    }

    stop() { BdApi.Patcher.unpatchAll(config.info.id); }
}

function createCache() {
    //What context menus we want to patch
    //Allllll the context menus related to users Let's see what sticks.
    RightClickJoin.guildUserContextMenus = BdApi.findModule(m => m.default && m.default.displayName === "GuildChannelUserContextMenu");
    RightClickJoin.dmUserContextMenu = BdApi.findModule(m => m.default && m.default.displayName === "DMUserContextMenu");

    //Specific functions we need, nothing like a big module
    RightClickJoin.getVoiceStatesForChannel = BdApi.findModuleByProps("getAllVoiceStates", "getVoiceStatesForChannel").getVoiceStatesForChannel;
    RightClickJoin.getChannels = BdApi.findModuleByProps("getChannels", "getDefaultChannel").getChannels;
    RightClickJoin.selectVoiceChannel = BdApi.findModuleByProps("selectChannel").selectVoiceChannel;
    RightClickJoin.fetchProfile = BdApi.findModuleByProps("fetchProfile").fetchProfile;

    //GuildStore
    RightClickJoin.GuildStore = BdApi.findModuleByProps("getGuild", "getGuilds");
    RightClickJoin.ChannelStore = BdApi.findModuleByProps("getChannel", "getDMFromUserId");
    RightClickJoin.MutualStore = BdApi.findModuleByProps("isFetching", "getUserProfile");

    //React and shit
    RightClickJoin.ce = BdApi.React.createElement;
    //Context controls (mainly just the one item we insert)
    RightClickJoin.MenuItem = BdApi.findModuleByProps("MenuRadioItem", "MenuItem").MenuItem;
}

function patchGuildChannelUserContextMenu() {
    //Patch in our context item under our name
    BdApi.Patcher.after(config.info.id, RightClickJoin.guildUserContextMenus, "default", (that, [props], returnValue) => {
        //Enter the world of patching

        let indexObject = { section: 1, child: 3 };
        let channel = RightClickJoin.ChannelStore.getChannel(props.channelId)

        if (channel.isVocal())
            //if we right click a channel in the list, we can mitigate our intense searching.
            constructMenuItem(props.user.id, returnValue, indexObject, channel.id)
        else
            //Drop right into it for the guilds; Don't have to catch the return either.
            checkMenuItem(RightClickJoin.getChannels(props.guildId).VOCAL, props.user.id, returnValue, indexObject)

    });
}

function patchDMUserContextMenu() {
    //Patch in our context item under our name
    BdApi.Patcher.after(config.info.id, RightClickJoin.dmUserContextMenu, "default", (that, [props], returnValue) => {
        //Enter the world of patching

        //Now we gotta check mutual guilds to see if we match anything
        let userId = props.user.id;
        //                                                    Dumb shit, null checking 'n all.
        let mutualGuilds = RightClickJoin.MutualStore.getMutualGuilds(userId) ?? [];
        let indexObject = { section: 2, child: 1 };

        if (mutualGuilds.length < 1) {
            //Gotta make sure we're not fetching already (or risk spamming the API)
            if (RightClickJoin.MutualStore.isFetching(userId))
                return;

            //Fetch and then we need to fill "mutualGuilds" again, so we just pass the call
            RightClickJoin.fetchProfile(userId).then(dmPatchHandler(RightClickJoin.MutualStore.getMutualGuilds(userId)));
        }
        else
            dmPatchHandler(mutualGuilds)

        function dmPatchHandler(_mutualGuilds = []) {
            //So we need a loop through if there's many
            for (let i = 0; i < _mutualGuilds.length; i++)
                //We need to have a way to break early
                //if we find anything to reduce resource consumption
                //You can only be connected to one voicechannel anyway
                if (checkMenuItem(RightClickJoin.getChannels(_mutualGuilds[i].guild.id).VOCAL, userId, returnValue, indexObject))
                    break;
        }
    });
}

function checkMenuItem(voiceChannels, userId, returnValue, indexObject) {
    //Gotta make sure this man is actually in a voice call
    //Loopy whoop
    for (let i = 0; i < voiceChannels.length; i++)
        if (constructMenuItem(userId, returnValue, indexObject, voiceChannels[i].channel.id))
            return true;
    //Return false so our DM patch knows what to do.
    return false;
}

function constructMenuItem(userId, returnValue, indexObject, channelId) {
    //Get all the participants in this voicechannel
    let participants = RightClickJoin.getVoiceStatesForChannel(channelId);

    //Loopy doop
    for (let id in participants)
        //If a matching participant is found, engage
        if (participants[id].userId === userId) {
            //Splice and insert our context item
            //          the menu,      the sections,     the items of this section
            returnValue.props.children.props.children[indexObject.section].props.children.splice(
                //We want it after the "call" option.
                indexObject.child,
                0,
                RightClickJoin.ce(RightClickJoin.MenuItem, {
                    //Discord Is One Of Those
                    label: "Join Call",
                    id: config.info.name.toLowerCase().replace(' ', '-'),
                    action: () => {
                        //Joining a voicechannel
                        RightClickJoin.selectVoiceChannel(channelId);
                    }
                })
            );
            //Return entirely, since only one voicechannel is possible.
            return true;
        }
}
