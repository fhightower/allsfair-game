(ns squarular.data)

(def empty-square {:player nil :count nil})
(def player-one-start-square {:player 1 :count 0})
(def player-two-start-square {:player 2 :count 0}))

(defn create-board [side-size]
    (let [player-one-square (assoc player-one-start-square :count side-size)
          player-two-square (assoc player-two-start-square :count side-size)
          empty-squares-count (- (* side-size side-size) 2)
          board (add-x-n-times [player-one-square] empty-square empty-squares-count)]
        (conj board player-two-square)))
