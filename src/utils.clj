(ns utils)

(use '[clojure.string :refer (split)])

(def empty-square {:owner nil :count nil})

(defn process-move [move]
  {:start (first move) :end (second move) :count (Integer. (second (split move #"[a-h]{2}")))})
