/**
 @module ember
 @submodule ember-routing
 */
Ember.RouteQuery = Ember.Object.extend({
  handler: '',
  query: {}
});

Ember.RouteQuery.reopenClass({
  query: function(query, route) {
    return this.create({
      query: query,
      handler: route
    });
  }
});