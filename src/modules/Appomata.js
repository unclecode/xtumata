import {
    Observable
} from 'object-observer/dist/object-observer'
import {
    h,
    diff,
    patch,
    create
} from 'virtual-dom'

window.k = {
    h,
    diff,
    patch,
    create
}

import {
    assert,
    EventBus
} from './helpers'

console.clear()

/**
 * A factory method generates all components required to set a finite state automata App design called Appomata
 */
let Appomata = (() => {
    let allTomata = {}
    let connectedApps = {}
    let names = new Set()
    let eventBus = EventBus()

    return new(class {
        constructor() {}

        /**
         * Create a shared rendered that renders the state of one or more automatas based on their current states. This the f(state) = view
         * Due to stateless property of view, then a view may be used for different machine as well as different states
         * @param {String} name View string name that should be unique
         * @param {Function} render function (automata, delta, omega) renders state to view
         * @param {String} automata The automata string name uses this view
         */
        createView({
            name,
            render,
            automata
        }) {
            assert(!names.has(name), "Given name already assigned to another view")
            assert(render !== undefined, "No render function is passed")
            let _render = render
            return new(class View {
                constructor() {

                    this.name = name
                    this.states = new Set()
                    this.automatas = new Set()
                    if (automata)
                        this.automata = automata
                    this.cachedNodes;
                }
                render({
                    automata,
                    delta,
                    omega
                }) {
                    this.cachedNodes = _render({
                        automata,
                        delta,
                        omega,
                        transit: this.transit.bind(this),
                        cachedNodes: this.cachedNodes
                    })
                    return this.cachedNodes;
                }
                transit({
                    input,
                    action,
                    name = "",
                    automata = ""
                }) {
                    automata = automata || this.automata

                    let transited = false
                    let targetAutomata = automata ? [allTomata[automata]] : Object.values(allTomata)

                    targetAutomata.forEach(a => {
                        if (a) {
                            transited = a.tryTransit({
                                name,
                                input,
                                action,
                                automata
                            })
                        }
                    })
                    if (!transited) {
                        throw `for given automata (${automata}), action (${action}) there is no any defined transition`
                    }
                }
            })
        }

        /**
         * Return a new instance of State class with the given configuration.
         * At the moment this creatState doesn't do that much, just create 
         * instance and return it back.
         * @param { Object } configuration State configuration contains three values of {name as state name, local as state local data, actions as state actions for transition 
         */
        createState({
            name,
            local = {},
            actions = {}
        }) {
            let state = new State({
                name,
                local,
                actions
            })
            return state
        }
        /**
         * Creating one instance of Automata "finite-state-automata"
         * @param {Object} configuration FSA config contains:
         * - name: FSA name
         * - state: [] List of states for this automata (optional)
         * - context: {} The main shared context that will be observable, changes trigger app(s) to render themselves
         * - buffer: {} Local context that will be shared only within state in this automata
         */
        createAutomata({
            name,
            states = [],
            context = {},
            buffer = {}
        }) {
            let automata = new Automata({
                name,
                states,
                context,
                buffer
            })
            allTomata[name] = automata
            connectedApps[name] = new Set()
            /**
             * Register to "afterTransition" to call all App.onTransition callback that eventually 
             * forces all apps to render the new state into the states engaged views
             */
            automata.on("afterTransition", (transitionEvent) => {
                connectedApps[name].forEach(app => {
                    if (app.onTransition)
                        app.onTransition(transitionEvent)
                })
            })

            // Add failed state in the automata
            automata.addState(new State({
                name: "failed",
                actions: {
                    failed: async (delta) => {
                        let {
                            input,
                            buffer,
                        } = delta;
                        buffer.failedOutput = {
                            message: input.message,
                            from: input.from
                        }
                        return omega("failed", buffer.failedOutput)
                    },
                    back: async (delta) => {
                        let {
                            buffer,
                        } = delta;
                        return omega(buffer.failedOutput.from, {})

                    }
                }
            }))


            return automata
        }
        /**
         * Connect an app to the given list of automatas. Whenever a transition
         * happens then the connected app will be notified vis app.onAutomataTransition if exists
         * @param {Object} configuration 
         * {
         *      app: App instance
         *      automatas: List of string names of registered Automatas in this Appomata
         * }  
         */
        connect({
            app,
            automatas
        }) {
            automatas.forEach(f => {
                if (allTomata[f]) {
                    connectedApps[f].add(app)
                    app.ugly = app.ugly || {
                        automata: {}
                    }
                    app.ugly.automata[f] = allTomata[f]
                }
            })
        }

        /**
         * Helper to create a delta object contains {action, input}
         * @param {String} action String name of delta action
         * @param {Object} input Object contains the input data for delta transition
         * @param {String} from String name of source state that transition is incident from
         */
        createDelta(action, input, from = "") {
            return {
                action,
                input,
                from
            }
        }
        /**
         * 
         * @param {String} next String name of the next state which is going to be incidents to
         * @param {Object} Transition output object that will be returned component requested the transition 
         * @param {Object} context Omega may contains the context which is not gonna be shared with component (internal usage)
         */
        createOmega(next, output, views = [], context = {}) {
            return {
                next,
                output,
                views,
                context
            }
        }
    })()
})();

/**
 * Class represent the Finite-State-Automata 
 */
let Automata = (() => {
    let states = {}
    let automataEventBus = EventBus()
    class Automata {
        /**
         * Create a FSA that we call is Automata contains sequence of states and control transition between all these states.
         * It contains a shared observable context that any change on it will trigger all subdribers
         * to onTransitionListeners.
         * @param {Object} configuration Automata configuration object contains  
         * - name: String Automata name
         * - states: List Contains list of all state from State class
         * - context: Object The main shared context that will be observed
         * - buffer: Object Local context will be shared only within the internal states transition
         */
        constructor({
            name,
            states = [],
            context = {},
            buffer = {}
        }) {
            this.name = name;
            this.buffer = buffer
            this.context = context
            this._beObservable()
            states.forEach(this.addState)
            this.now = null;

            this.on = automataEventBus.on;
            this.off = automataEventBus.on;

        }

        _beObservable() {
            this.context = Observable.from(this.context)
            this.context.observe(changes => {
                automataEventBus.emit("stateChanged", {
                    automata: this.name,
                    //context: JSON.parse(JSON.stringify(this.context)),

                    // TODO 
                    // changes: changes.map(c => ({
                    //     path: c.path,
                    //     value: JSON.parse(JSON.stringify(c.value || {})),
                    //     object: JSON.parse(JSON.stringify(c.object || {}))
                    // }))

                })
            })
        }

        /**
         * Set the initial state and set current state of Automata to it
         * @param {String} initState Initial state name
         */
        init(initState) {
            if (states[initState]) {
                this.initialState = initState;
                this.now = states[initState]
            } else
                throw "given state doesn't exists"
        }

        /**
         * Trey to see whether or not the given pair of (input, action) matches to the current state
         * and if yes then transit and returns true. It will returns false if it doesn't match
         * @param {Object} param0 Delta object {input, action}
         */
        tryTransit({
            input,
            action
        }) {
            if (this.now[action]) {
                this.transit(Appomata.createDelta(action, input))
                return true
            }
            return false

        }

        /**
         * Add a new state to the list of states. It will set the automata name for
         * both of state and it's view.
         * @param {State} state An instance of state class {name, actions, local}
         */
        addState(state) {
            if (!states[state.name]) {
                state.automata = this.name;
                Object.entries(state.views).forEach(([key, value]) => {
                    state.views[key].automata = this.name
                })
                states[state.name] = state;
            }
        }


        /**
         * Register a view instance to the given state. One state may have multiple views, these views
         * will be given to App engine to render whenever Automata transmit to the given state 
         * @param {View} view View instance
         * @param {String} state String of name of the state attaches to the given view
         */
        addView(view, state = "") {
            let attachedStates = state ? [state] : Object.keys(states)
            attachedStates.filter(s => states[s]).forEach(s => {
                view.automatas.add(this.name);
                states[s].addView(view);
            });
        }

        /**
         * This is the transit function that will be called components
         * or main app instance and pass delta. After receiving the delta
         * current state as well as the observed context will be added to delta
         * plus the local context of state automata, to keep shared
         * data between transition within the automata that does not 
         * required observing (like keys={}). Later this delta
         * is passed to relevant state to be executed
         * 
         * Return: It returns an omega value which is {output, next}
         * @param {Delta transition function that carries the action as well as the input data} delta 
         */
        async transit(delta) {
            // TODO: Add hooks as much as you can, i'ts great to add some tasks afetr every transition, like logging, or for example set the task status idle
            if (!this.now)
                throw "Current state is not initialized"
            delta.from = this.now.name;
            let loadedDelta = {
                ...delta,
                context: this.context,
                buffer: this.buffer
            }

            automataEventBus.emit("beforeTransition", loadedDelta)
            let omega;
            try {
                omega = await this.now.transit(loadedDelta);
                this.now.cleanUp()
                this.now = states[omega.next] || states.init || states.failed;
            } catch (e) {
                automataEventBus.emit("failedTransition", loadedDelta)
                this.now.transit("failed", {
                    ...loadedDelta,
                    e
                })
                this.now.cleanUp()
                this.now = states.failed;
            }


            // get new current state attached views to be passed to App renderer
            // f(state) = {v1, v2, ..., vk}
            omega.views = Object.values(this.now.views)

            omega = Appomata.createOmega(omega.next, omega.output, omega.views)

            //? No need If I dont want reactivity
            omega.output = omega.output || {}
            omega.output.context = JSON.parse(JSON.stringify(loadedDelta.context))
            omega.output.buffer = loadedDelta.buffer

            // update the App engine to render its relevant components
            let transitionOutputData = {
                automata: this.name,
                delta,
                omega
            }
            automataEventBus.emit("dataTransition", transitionOutputData)
            automataEventBus.emit("afterTransition", transitionOutputData)
            return omega
        }
    }

    return Automata;

})()



/**
 * Class presents a state in FSA, this state has one or more action and one
 * transit function that accepts the delta transition value, based on requested action, the relevant
 * actions will be executed and output or omega (contains new state and return data) 
 * will be given back to state automata
 */
class State {
    /**
     * Return a new instance of State class with the given configuration.
     * @param { Object } configuration State configuration contains three values of {name as state name, local as state local data, actions as state actions for transition 
     */
    constructor({
        name,
        local = {},
        actions = {},
        views = {}
    }) {
        this.name = name;
        this.local = local;
        this.views = views
        Object.entries(actions).forEach(e => {
            this.defineAction({
                name: e[0],
                f: e[1]
            })
        })
    }
    addView(view) {
        if (!this.views[view.name]) {
            view.states.add(this.name)
            this.views[view.name] = view;
        }
    }
    /**
     * This is called by the "transition" function within the main Automata (state automata) ad long
     * that passed the delta info, here the requested action will be selected and after execution of the action
     * the output or "omega" will be returned, in case action does not exist it will transit into failed state
     * The delta contains {action, input, context, buffer}
     * @param {Transition delta function contain action, input, from, FSA local context, and observed context} delta 
     */
    async transit(delta) {
        return (this[delta.action] && await this[delta.action](delta)) || this.failed(delta)
    }
    failed(delta) {
        return Appomata.createOmega("failed", {
            name: this.name,
            ...delta
        })
    }
    /**
     * Pair of action name and it 's handler that is going to be added to this state.
     * Every action is a function with delta as it's input parameter.
     * The delta contains {action, input, context, buffer}
     * @param {Object contains two values of {name: action name, f: an async action function}} param0 
     */
    defineAction({
        name,
        f
    }) {
        this[name] = (delta) => f(delta);
    }
    cleanUp() {}
}

// TODO: create Halt state

/**
 * App class that control components rendering, connection between Appomata and
 * UI layers, manage routing, by mapping the Automata (states), listening to changes on states
 * and calculate the f(state) to produce the stated view rather than let states
 * manipulate the state based on the reactivity
 */
let App = (() => {
    let appEventBus = EventBus()
    class App {
        /**
         * Create an instance App
         * @param {String} name App name!
         */
        constructor(name) {
            this.name = name;
            this.layouts = {}
            this.components = {}
            this.componentsVTrees = {}

            this.on = appEventBus.on;
            this.off = appEventBus.on;
        }

        /**
         * An event calls by Automata on every transition. This attachment
         * happens when we connect the Automata to this app.
         * @param {Object} transitionEvent Event object contains the information about
         * changed state that contains:
         * - automata:String Thr Automata string name
         * - delta:Object {action, input}
         * - omega:Object {next, output} 
         */
        onTransition(transitionEvent) {
            // check components have this automata and delta.action in 
            // their registered states, and render them and that 
            // apply diff and patch them
            appEventBus.emit("beforAppRender", transitionEvent)
            this.render(transitionEvent)
            appEventBus.emit("afterAppRender", transitionEvent)
        }
        /**
         * Add layout component instance to the list of layouts
         * @param {Component} layout Layout component instance
         * @param {List} automataActionMap List of automata.action forces the 
         * the component view states changes
         */
        addLayout(layout, automataActionMap = []) {
            let s = []
            automataActionMap.forEach(m => {
                s = this._extractStatePath(m)
            })
            this.layouts[layout.name] = {
                layout,
                statePath: s
            }
        }
        /**
         * Add a component instance to the list of components
         * @param {Component} component component instance
         * @param {List} automataStateMap List of automata.action forces the the component view states changes
         */
        addComponent(component, automataStateMap = []) {
            let s = []
            automataStateMap.forEach(m => {
                s = this._extractStatePath(m)
            })
            this.components[component.name] = {
                component,
                statePath: s
            }
        }
        _extractStatePath(stateMapString) {
            let s = {}
            stateMapString.split(',').forEach(m => {
                let automata = m.split('.')[0]
                let action = m.split('.')[1]
                s[automata] = s[automata] || []
                s[automata].push(action)
            })
            return s
        }

        /**
         * Render app by walking through layouts and components rendering. This is 
         * triggered by a change in state automata
         * @param {Object} transition Contains information on happened transition
         * this object follows: 
         * - automata: String
         * - delta: {action, input}
         * - omega: {next, output, **transit**} the transit function will be
         * available for component to call it for the next action
         */
        render(transition = {}) {
            let {
                automata,
                delta,
                omega
            } = transition;

            let renderedViews = []
            for (const view of omega.views) {
                let viewRenderData = {
                    automata,
                    delta,
                    omega
                }
                appEventBus.emit("beforeAppViewRender", viewRenderData)
                let vnode = view.render(viewRenderData)
                appEventBus.emit("afterAppViewRender", vnode)

                renderedViews.push(vnode)
            }



            let newRootTree = h('div.app', renderedViews)
            appEventBus.emit("beforeAppDiff", newRootTree)
            const patches = diff(this.rootTree, newRootTree);
            this.rootTree = newRootTree
            appEventBus.emit("beforeAppPatch", patches)
            this.rootNode = patch(this.rootNode, patches);
        }

        /**
         * Mount the VDom od the app to the given DOM node
         * @param {DOM Node} rootElem Root of the app
         */
        mount(rootElem) {
            appEventBus.emit("beforeAppMount", rootElem)
            if (!this.rootTree) {
                this.rootTree = h('div.app')
                this.rootNode = create(this.rootTree)
                rootElem.appendChild(this.rootNode)
            }
            appEventBus.emit("afterAppMount", this.rootTree)
            return this
        }

        /**
         * Mount app instance to the given DOM element, connect app with given automatas,
         * transit to "init" state of automata. 
         * @param {Array|String} automata List of automata names that app instance connects, these automatas must be created already with Appomata
         * @param {DOM Element} rootElement DOM physical element
         */
        run(automata, rootElement, action = "init") {
            this.mount(rootElement)

            Appomata.connect({
                app: this,
                automatas: Array.isArray(automata) ? [automata.name] : [automata].map(a => a.name)
            })

            return automata.transit({
                input: "",
                action
            })
        }
    }
    return App;
})()

export {
    Appomata as
    default,
    State,
    App,
    Automata
};
