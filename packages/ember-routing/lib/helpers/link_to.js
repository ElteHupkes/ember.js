/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set,
  forEach = Ember.ArrayPolyfills.forEach;

require('ember-handlebars/helpers/view');

Ember.onLoad('Ember.Handlebars', function(Handlebars) {

  var resolveParams = Ember.Router.resolveParams,
      isSimpleClick = Ember.ViewUtils.isSimpleClick;

  function fullRouteName(router, name) {
    if (!router.hasRoute(name)) {
      name = name + '.index';
    }

    return name;
  }

  function resolvedPaths(options) {
    var types = options.options.types.slice(1),
        data = options.options.data;

    return resolveParams(options.context, options.params, { types: types, data: data });
  }

  function args(linkView, router, route) {
    var passedRouteName = route || linkView.namedRoute, routeName;

    routeName = fullRouteName(router, passedRouteName);

    Ember.assert("The route " + passedRouteName + " was not found", router.hasRoute(routeName));

    var ret = [ routeName ].concat(resolvedPaths(linkView.parameters)), query;
    if (query = linkView.get('handlerQuery')) {
      ret.push(router.routeQuery(routeName, query));
    }
    return ret;
  }

  /**
    Renders a link to the supplied route.

    When the rendered link matches the current route, and the same object instance is passed into the helper,
    then the link is given class="active" by default.

    You may re-open LinkView in order to change the default active class:

    ``` javascript
    Ember.LinkView.reopen({
      activeClass: "is-active"
    })
    ```

    @class LinkView
    @namespace Ember
    @extends Ember.View
  **/
  var LinkView = Ember.LinkView = Ember.View.extend({
    tagName: 'a',
    namedRoute: null,
    currentWhen: null,
    title: null,
    activeClass: 'active',
    replace: false,
    attributeBindings: ['href', 'title'],
    classNameBindings: 'active',

    init: function() {
      this._super.apply(this, arguments);

      var args = ['query'].concat(this.get('queryList'));
      var func = Ember.computed(function() {
        var query = this.get('query'), queryList = this.get('queryList');
        if (!query && queryList.length) {
          query = {};
        }

        Ember.assert("Link query has to be an object", !query || typeof query === "object");

        // Expand with static query arguments
        for (var i = 0, l = queryList.length; i < l; i++) {
          query[queryList[i]] = this.get(queryList[i]);
        }

        return query === false ? {} : query;
      });

      func.property.apply(func, args);
      Ember.defineProperty(this, 'handlerQuery', func);
    },

    // Even though this isn't a virtual view, we want to treat it as if it is
    // so that you can access the parent with {{view.prop}}
    concreteView: Ember.computed(function() {
      return get(this, 'parentView');
    }).property('parentView'),

    active: Ember.computed(function() {
      var router = this.get('router'),
          params = resolvedPaths(this.parameters),
          currentWithIndex = this.currentWhen + '.index',
          isActive = router.isActive.apply(router, [this.currentWhen].concat(params)) ||
                     router.isActive.apply(router, [currentWithIndex].concat(params));

      if (isActive) { return get(this, 'activeClass'); }
    }).property('namedRoute', 'router.url'),

    router: Ember.computed(function() {
      return this.get('controller').container.lookup('router:main');
    }),

    click: function(event) {
      if (!isSimpleClick(event)) { return true; }

      event.preventDefault();
      if (this.bubbles === false) { event.stopPropagation(); }

      var router = this.get('router');

      if (this.get('replace')) {
        router.replaceWith.apply(router, args(this, router));
      } else {
        router.transitionTo.apply(router, args(this, router));
      }
    },

    href: Ember.computed(function() {
      var router = this.get('router');
      return router.generate.apply(router, args(this, router));
    }).property('handlerQuery')
  });

  LinkView.toString = function() { return "LinkView"; };

  /**
    @method linkTo
    @for Ember.Handlebars.helpers
    @param {String} routeName
    @param {Object} [context]*
    @return {String} HTML string
  */
  Ember.Handlebars.registerHelper('linkTo', function(name) {
    var options = [].slice.call(arguments, -1)[0];
    var params = [].slice.call(arguments, 1, -1);

    var hash = options.hash;
    var isQueryRegex = /^(.+)Query(Binding)?$/, queryList = [],
        match;

    // Detect query strings for referenced handler
    forEach.call(Ember.keys(hash), function(key) {
      if (match = key.match(isQueryRegex)) {
        hash[match[1]+(match[2] || '')] = hash[key];
        queryList.push(match[1]);
        delete hash[key];
      }
    });

    hash.queryList = queryList;
    hash.namedRoute = name;
    hash.currentWhen = hash.currentWhen || name;

    hash.parameters = {
      context: this,
      options: options,
      params: params
    };

    return Ember.Handlebars.helpers.view.call(this, LinkView, options);
  });

});

