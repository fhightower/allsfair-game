(ns utils-test
  (:require [clojure.test :refer [deftest is testing]]
            [utils :refer [process-move]]))

(deftest process-move-valid-1-digit-count
  (testing "process-move handles a count with 1 digit"
    (is (= (get (process-move "ab3") :count) 3))))

(deftest process-move-valid-2-digits-count
  (testing "process-move handles a count with 2 digits"
    (is (= (get (process-move "ab31") :count) 31))))

(deftest process-move-valid-3-digits-count
  (testing "process-move handles a count with 3 digits"
    (is (= (get (process-move "ab312") :count) 312))))

;; this raises an error which is currently not handled...
;; (deftest process-move-invalid
;;   (testing "process-move handles invalid moves"
;;     (is (= (get (process-move "ab") :count) 0))))
